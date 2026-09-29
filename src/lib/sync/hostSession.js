// Runs the authoritative game engine in memory and mirrors state onto the
// room's Firestore doc — the transport Discord Activities can actually use
// (their iframe network sandbox blocks raw WebRTC; see README). Peers submit
// actions into rooms/{code}/actions and this listens for them, applies each
// in arrival order, and writes the result back onto that same doc.
import { doc, updateDoc, collection, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { PHASE_ACTION_NAMES } from './protocol.js'
import { getEngine } from '../uno/modes.js'
import { MIN_PLAYERS } from '../uno/constants.js'

const HEARTBEAT_INTERVAL_MS = 4000

function roomRef(code) {
  return doc(db, 'rooms', code)
}

export class HostSession {
  constructor({ code, hostUid, onStateChange }) {
    this.code = code
    this.hostUid = hostUid
    this.onStateChange = onStateChange
    this.game = null
    this.status = 'lobby'
    this.config = {}
    this.players = []
    this.destroyed = false
    this._configInitialized = false

    const actionsQuery = query(collection(db, 'rooms', code, 'actions'), orderBy('createdAt'))
    this.unsubscribeActions = onSnapshot(actionsQuery, (snap) => {
      if (this.destroyed) return
      const added = snap.docChanges().filter((c) => c.type === 'added')
      if (!added.length) return
      for (const change of added) {
        const data = change.doc.data()
        let result
        try {
          this._applyAction(data.action, data.args)
          result = { ok: true }
        } catch (e) {
          result = { ok: false, message: e.message }
        }
        updateDoc(change.doc.ref, { result }).catch(() => {})
      }
      this.onStateChange(this.status, this.game)
      this._persistState()
    })

    this._heartbeatTimer = setInterval(() => this._beat(), HEARTBEAT_INTERVAL_MS)
    this._beat()
  }

  // A reconnecting host (page reload mid-round) picks its in-memory state
  // back up from the lobby doc it last mirrored, instead of resetting to an
  // empty lobby — only on the first call, so later config/roster updates
  // during a live round never clobber local game progress.
  updateConfig(lobbyDoc) {
    if (!this._configInitialized) {
      this._configInitialized = true
      if (lobbyDoc.status && lobbyDoc.status !== 'lobby' && lobbyDoc.game) {
        this.game = lobbyDoc.game
        this.status = lobbyDoc.status
      }
    }
    this.config = {
      mode: lobbyDoc.mode,
      targetScore: lobbyDoc.targetScore,
      mercyLimit: lobbyDoc.mercyLimit,
      jumpInEnabled: lobbyDoc.jumpInEnabled,
    }
    this.players = lobbyDoc.players
  }

  dispatch(actionName, args) {
    try {
      this._applyAction(actionName, args)
    } catch (e) {
      return Promise.reject(e)
    }
    this.onStateChange(this.status, this.game)
    this._persistState()
    return Promise.resolve()
  }

  destroy() {
    this.destroyed = true
    if (this.unsubscribeActions) this.unsubscribeActions()
    clearInterval(this._heartbeatTimer)
  }

  // ---- engine dispatch ----

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
      // Reseat off the room's current roster, not the stale one the round
      // started with — anyone who joined mid-round while spectating gets
      // dealt in now, and anyone who left is dropped.
      this.game = engine.startNextRound(this.game, this.players)
      this.status = 'playing'
    } else if (actionName === 'returnToLobby') {
      this.game = null
      this.status = 'lobby'
    }
  }

  // ---- Firestore mirroring ----

  _beat() {
    if (this.destroyed) return
    updateDoc(roomRef(this.code), { hostHeartbeat: serverTimestamp() }).catch(() => {})
  }

  _persistState() {
    updateDoc(roomRef(this.code), { status: this.status, game: this.game }).catch(() => {})
  }
}
