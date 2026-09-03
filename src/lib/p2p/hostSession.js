// Runs the authoritative game engine in memory and relays state to every
// connected peer over its own RTCDataChannel (star topology — host is the
// hub, peers never talk to each other directly).
import { createPeerConnection, CONNECT_TIMEOUT_MS } from './connection.js'
import { watchSignal, publishOffer, pushHostCandidates, clearSignal } from './signaling.js'
import { PHASE_ACTION_NAMES } from './protocol.js'
import { getEngine } from '../uno/modes.js'
import { MIN_PLAYERS } from '../uno/constants.js'

// Bounded backoff for a peer whose channel drops — covers both a genuinely
// unreachable ("ghost") player and a legitimate page-refresh reconnect. Once
// exhausted, the peer is left disconnected; the existing AFK auto-play
// system covers their turns for the rest of the round.
const RETRY_DELAYS_MS = [1000, 3000, 8000]

export class HostSession {
  constructor({ code, hostUid, onStateChange }) {
    this.code = code
    this.hostUid = hostUid
    this.onStateChange = onStateChange
    this.game = null
    this.status = 'lobby'
    this.config = {}
    this.players = []
    this.links = new Map() // peerUid -> link
    this.destroyed = false
  }

  updateConfig(lobbyDoc) {
    this.config = {
      mode: lobbyDoc.mode,
      targetScore: lobbyDoc.targetScore,
      mercyLimit: lobbyDoc.mercyLimit,
      jumpInEnabled: lobbyDoc.jumpInEnabled,
    }
    this.players = lobbyDoc.players
  }

  syncPeers(players) {
    if (this.destroyed) return
    const currentUids = new Set(players.filter((p) => p.uid !== this.hostUid).map((p) => p.uid))
    for (const uid of this.links.keys()) {
      if (!currentUids.has(uid)) this._removePeer(uid)
    }
    for (const uid of currentUids) {
      if (!this.links.has(uid)) this._addPeer(uid)
    }
  }

  dispatch(actionName, args) {
    try {
      this._applyAndBroadcast(actionName, args)
    } catch (e) {
      return Promise.reject(e)
    }
    return Promise.resolve()
  }

  destroy() {
    this.destroyed = true
    for (const link of this.links.values()) this._teardownLink(link)
    this.links.clear()
  }

  // ---- engine dispatch ----

  _applyAndBroadcast(actionName, args) {
    this._applyAction(actionName, args)
    this.onStateChange(this.status, this.game)
    this._broadcastState()
  }

  _applyAction(actionName, args) {
    if (PHASE_ACTION_NAMES.includes(actionName)) {
      this._applyPhase(actionName)
      return
    }
    if (!this.game) throw new Error('Game has not started.')
    const engine = getEngine(this.game.mode)
    const fn = engine[actionName]
    if (typeof fn !== 'function') {
      throw new Error(`${actionName} isn't available in ${this.game.mode === 'no-mercy' ? 'No Mercy' : 'Classic'} mode.`)
    }
    const next = fn(this.game, ...args)
    this.game = next
    if (next.status === 'game-over') this.status = 'finished'
  }

  _applyPhase(actionName) {
    if (actionName === 'startGame') {
      if (this.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players.`)
      const engine = getEngine(this.config.mode)
      this.game = engine.createRound(this.players, {
        targetScore: this.config.targetScore,
        mercyLimit: this.config.mercyLimit,
        jumpInEnabled: this.config.jumpInEnabled,
      })
      this.status = 'playing'
    } else if (actionName === 'startNextRound') {
      if (!this.game) throw new Error('Game has not started.')
      const engine = getEngine(this.game.mode)
      this.game = engine.startNextRound(this.game)
      this.status = 'playing'
    } else if (actionName === 'returnToLobby') {
      this.game = null
      this.status = 'lobby'
    }
  }

  handleIncomingMessage(peerUid, msg) {
    if (msg.type !== 'action') return
    const link = this.links.get(peerUid)
    if (!link) return
    try {
      this._applyAndBroadcast(msg.action, msg.args)
      this._send(link, { v: 1, type: 'action-result', requestId: msg.requestId, ok: true })
    } catch (e) {
      this._send(link, { v: 1, type: 'action-result', requestId: msg.requestId, ok: false, message: e.message })
    }
  }

  _broadcastState() {
    const payload = JSON.stringify({ v: 1, type: 'state', status: this.status, game: this.game })
    for (const link of this.links.values()) {
      if (link.channel && link.channel.readyState === 'open') link.channel.send(payload)
    }
  }

  _send(link, obj) {
    if (link.channel && link.channel.readyState === 'open') link.channel.send(JSON.stringify(obj))
  }

  // ---- connection lifecycle ----

  _addPeer(uid) {
    const link = {
      uid,
      pc: null,
      channel: null,
      unsubscribeSignal: null,
      appliedPeerCandidateCount: 0,
      queuedCandidates: [],
      candidateBuffer: [],
      candidateFlushTimer: null,
      connectTimeoutTimer: null,
      retryTimer: null,
      retryAttempt: 0,
      status: 'connecting',
    }
    this.links.set(uid, link)
    this._openConnection(link)
  }

  _removePeer(uid) {
    const link = this.links.get(uid)
    if (!link) return
    this._teardownLink(link)
    this.links.delete(uid)
    clearSignal(this.code, uid)
  }

  _openConnection(link) {
    link.appliedPeerCandidateCount = 0
    link.queuedCandidates = []
    link.candidateBuffer = []
    link.status = 'connecting'

    const pc = createPeerConnection()
    link.pc = pc
    const channel = pc.createDataChannel('game', { ordered: true })
    link.channel = channel
    this._wireChannel(link, channel)

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      link.candidateBuffer.push(e.candidate.toJSON())
      if (!link.candidateFlushTimer) {
        link.candidateFlushTimer = setTimeout(() => {
          const batch = link.candidateBuffer
          link.candidateBuffer = []
          link.candidateFlushTimer = null
          pushHostCandidates(this.code, link.uid, batch)
        }, 150)
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this._handlePeerDropped(link)
    }

    link.unsubscribeSignal = watchSignal(this.code, link.uid, (data) => {
      if (!data) return
      if (data.answer && pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(data.answer).then(() => {
          const queued = link.queuedCandidates
          link.queuedCandidates = []
          for (const c of queued) pc.addIceCandidate(c).catch(() => {})
        })
      }
      const peerCandidates = data.peerCandidates || []
      const newOnes = peerCandidates.slice(link.appliedPeerCandidateCount)
      link.appliedPeerCandidateCount = peerCandidates.length
      if (pc.remoteDescription) {
        for (const c of newOnes) pc.addIceCandidate(c).catch(() => {})
      } else {
        link.queuedCandidates.push(...newOnes)
      }
    })

    link.connectTimeoutTimer = setTimeout(() => {
      if (link.status !== 'connected') this._handlePeerDropped(link)
    }, CONNECT_TIMEOUT_MS)

    clearSignal(this.code, link.uid)
      .then(() => pc.createOffer())
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => publishOffer(this.code, link.uid, pc.localDescription))
      .catch(() => {
        // A torn-down/replaced connection (e.g. the peer left right after
        // joining) can abort this chain mid-flight — handled by the normal
        // drop/retry path, nothing more to do here.
      })
  }

  _wireChannel(link, channel) {
    channel.onopen = () => {
      link.status = 'connected'
      link.retryAttempt = 0
      clearTimeout(link.connectTimeoutTimer)
      if (link.unsubscribeSignal) {
        link.unsubscribeSignal()
        link.unsubscribeSignal = null
      }
      clearSignal(this.code, link.uid)
      // Doubles as resync for a reconnecting peer: if a game is already in
      // progress, they get a fresh full copy the moment their channel opens.
      if (this.game) {
        this._send(link, { v: 1, type: 'state', status: this.status, game: this.game })
      }
    }
    channel.onclose = () => this._handlePeerDropped(link)
    channel.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      this.handleIncomingMessage(link.uid, msg)
    }
  }

  _handlePeerDropped(link) {
    if (this.destroyed) return
    if (this.links.get(link.uid) !== link) return
    this._teardownLink(link)
    if (link.retryAttempt >= RETRY_DELAYS_MS.length) {
      link.status = 'failed'
      return
    }
    const delay = RETRY_DELAYS_MS[link.retryAttempt]
    link.retryAttempt += 1
    link.status = 'connecting'
    link.retryTimer = setTimeout(() => {
      link.retryTimer = null
      if (this.links.get(link.uid) === link) this._openConnection(link)
    }, delay)
  }

  _teardownLink(link) {
    clearTimeout(link.connectTimeoutTimer)
    clearTimeout(link.retryTimer)
    clearTimeout(link.candidateFlushTimer)
    if (link.unsubscribeSignal) {
      link.unsubscribeSignal()
      link.unsubscribeSignal = null
    }
    if (link.channel) {
      link.channel.onopen = null
      link.channel.onclose = null
      link.channel.onmessage = null
      try {
        link.channel.close()
      } catch {
        // already closed
      }
    }
    if (link.pc) {
      link.pc.onicecandidate = null
      link.pc.onconnectionstatechange = null
      try {
        link.pc.close()
      } catch {
        // already closed
      }
    }
    link.channel = null
    link.pc = null
  }
}
