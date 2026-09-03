// One RTCPeerConnection to the room's host. The host is always the WebRTC
// offerer, so this side just watches its own signaling doc for an offer,
// answers it, and relays action requests/state over the resulting channel.
import { createPeerConnection, CONNECT_TIMEOUT_MS } from './connection.js'
import { watchSignal, publishAnswer, pushPeerCandidates, clearSignal } from './signaling.js'
import { REQUEST_TIMEOUT_MS } from './protocol.js'

// If the channel drops after having connected once, give the host's own
// bounded retry (see hostSession.js RETRY_DELAYS_MS) a chance to reach us
// again before surfacing a terminal "host disconnected" state.
const RECONNECT_TIMEOUT_MS = 20000

export class PeerSession {
  constructor({ code, uid, onStateChange, onConnectionStatus }) {
    this.code = code
    this.uid = uid
    this.onStateChange = onStateChange
    this.onConnectionStatus = onConnectionStatus || (() => {})
    this.pc = null
    this.channel = null
    this.unsubscribeSignal = null
    this.appliedHostCandidateCount = 0
    this.queuedCandidates = []
    this.candidateBuffer = []
    this.candidateFlushTimer = null
    this.connectTimeoutTimer = null
    this.pending = new Map() // requestId -> { resolve, reject, timer }
    this.everConnected = false
    this.destroyed = false
    this._connect()
  }

  dispatch(actionName, args) {
    if (!this.channel || this.channel.readyState !== 'open') {
      return Promise.reject(new Error('Not connected to the host.'))
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Lost connection to host. Your move may not have gone through.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
      this.channel.send(JSON.stringify({ v: 1, type: 'action', requestId, action: actionName, args }))
    })
  }

  destroy() {
    this.destroyed = true
    this._teardownConnection()
    if (this.unsubscribeSignal) {
      this.unsubscribeSignal()
      this.unsubscribeSignal = null
    }
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
  }

  // ---- connection lifecycle ----

  _connect() {
    // Defensive: makes _connect() safe to call more than once in a row
    // (e.g. if a channel-close and a connection-state-change both fire for
    // the same drop) without leaking an orphaned Firestore listener.
    if (this.unsubscribeSignal) {
      this.unsubscribeSignal()
      this.unsubscribeSignal = null
    }
    this.appliedHostCandidateCount = 0
    this.queuedCandidates = []
    this.candidateBuffer = []
    this.onConnectionStatus('connecting')

    this.unsubscribeSignal = watchSignal(this.code, this.uid, (data) => {
      if (!data || this.destroyed) return
      if (data.offer && !this.pc) {
        this._acceptOffer(data.offer).catch(() => {
          // A torn-down connection mid-handshake is handled by the normal
          // disconnect/reconnect path — nothing more to do here.
        })
        return
      }
      if (this.pc) {
        const hostCandidates = data.hostCandidates || []
        const newOnes = hostCandidates.slice(this.appliedHostCandidateCount)
        this.appliedHostCandidateCount = hostCandidates.length
        if (this.pc.remoteDescription) {
          for (const c of newOnes) this.pc.addIceCandidate(c).catch(() => {})
        } else {
          this.queuedCandidates.push(...newOnes)
        }
      }
    })

    const timeoutMs = this.everConnected ? RECONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS
    this.connectTimeoutTimer = setTimeout(() => {
      if (!this.destroyed) this.onConnectionStatus(this.everConnected ? 'host-disconnected' : 'connect-failed')
    }, timeoutMs)
  }

  async _acceptOffer(offer) {
    const pc = createPeerConnection()
    this.pc = pc
    pc.ondatachannel = (e) => this._wireChannel(e.channel)
    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      this.candidateBuffer.push(e.candidate.toJSON())
      if (!this.candidateFlushTimer) {
        this.candidateFlushTimer = setTimeout(() => {
          const batch = this.candidateBuffer
          this.candidateBuffer = []
          this.candidateFlushTimer = null
          pushPeerCandidates(this.code, this.uid, batch)
        }, 150)
      }
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && this.pc === pc) this._handleDisconnect()
    }
    await pc.setRemoteDescription(offer)
    const queued = this.queuedCandidates
    this.queuedCandidates = []
    for (const c of queued) pc.addIceCandidate(c).catch(() => {})
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await publishAnswer(this.code, this.uid, pc.localDescription)
  }

  _wireChannel(channel) {
    this.channel = channel
    channel.onopen = () => {
      this.everConnected = true
      clearTimeout(this.connectTimeoutTimer)
      if (this.unsubscribeSignal) {
        this.unsubscribeSignal()
        this.unsubscribeSignal = null
      }
      clearSignal(this.code, this.uid)
      this.onConnectionStatus('connected')
    }
    channel.onclose = () => this._handleDisconnect()
    channel.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      this._handleMessage(msg)
    }
  }

  _handleMessage(msg) {
    if (msg.type === 'state') {
      this.onStateChange(msg.status, msg.game)
    } else if (msg.type === 'action-result') {
      const pending = this.pending.get(msg.requestId)
      if (!pending) return
      this.pending.delete(msg.requestId)
      clearTimeout(pending.timer)
      if (msg.ok) pending.resolve()
      else pending.reject(new Error(msg.message || 'The host rejected that action.'))
    }
  }

  _handleDisconnect() {
    if (this.destroyed) return
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Lost connection to the host.'))
    }
    this.pending.clear()
    this._teardownConnection()
    this._connect()
  }

  _teardownConnection() {
    clearTimeout(this.connectTimeoutTimer)
    clearTimeout(this.candidateFlushTimer)
    if (this.channel) {
      this.channel.onopen = null
      this.channel.onclose = null
      this.channel.onmessage = null
      try {
        this.channel.close()
      } catch {
        // already closed
      }
    }
    if (this.pc) {
      this.pc.onicecandidate = null
      this.pc.onconnectionstatechange = null
      this.pc.ondatachannel = null
      try {
        this.pc.close()
      } catch {
        // already closed
      }
    }
    this.channel = null
    this.pc = null
  }
}
