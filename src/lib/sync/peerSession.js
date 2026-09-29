// Reads live game state mirrored onto the room doc by the host (see
// hostSession.js), and submits this player's own actions into
// rooms/{code}/actions for the host to apply and answer.
import { doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { REQUEST_TIMEOUT_MS } from './protocol.js'

const CONNECT_TIMEOUT_MS = 15000
// How long the host's heartbeat can go stale before we declare it gone —
// well above HEARTBEAT_INTERVAL_MS (hostSession.js) to absorb a missed beat
// or two without flapping the UI.
const HEARTBEAT_TIMEOUT_MS = 12000
const HEARTBEAT_CHECK_MS = 3000

function roomRef(code) {
  return doc(db, 'rooms', code)
}

export class PeerSession {
  constructor({ code, uid, onStateChange, onConnectionStatus }) {
    this.code = code
    this.uid = uid
    this.onStateChange = onStateChange
    this.onConnectionStatus = onConnectionStatus || (() => {})
    this.destroyed = false
    this.connected = false
    this.lastHeartbeatAt = null

    this.onConnectionStatus('connecting')

    this.unsubscribeRoom = onSnapshot(roomRef(code), (snap) => {
      if (this.destroyed) return
      const data = snap.data()
      if (!data) return
      this.onStateChange(data.status, data.game ?? null)
      if (data.hostHeartbeat) {
        this.lastHeartbeatAt = Date.now()
        if (!this.connected) {
          this.connected = true
          clearTimeout(this._connectTimeoutTimer)
          this.onConnectionStatus('connected')
        }
      }
    })

    this._heartbeatCheckTimer = setInterval(() => this._checkHeartbeat(), HEARTBEAT_CHECK_MS)
    this._connectTimeoutTimer = setTimeout(() => {
      if (!this.destroyed && !this.connected) this.onConnectionStatus('connect-failed')
    }, CONNECT_TIMEOUT_MS)
  }

  dispatch(actionName, args) {
    const requestId = crypto.randomUUID()
    const ref = doc(db, 'rooms', this.code, 'actions', requestId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error('Lost connection to host. Your move may not have gone through.'))
      }, REQUEST_TIMEOUT_MS)
      const unsubscribe = onSnapshot(ref, (snap) => {
        const data = snap.data()
        if (!data?.result) return
        clearTimeout(timer)
        unsubscribe()
        deleteDoc(ref).catch(() => {})
        if (data.result.ok) resolve()
        else reject(new Error(data.result.message || 'The host rejected that action.'))
      })
      // JSON round-tripped so optional args (e.g. an unused chosenColor)
      // come through as null rather than undefined, which Firestore rejects.
      setDoc(ref, {
        uid: this.uid,
        action: actionName,
        args: JSON.parse(JSON.stringify(args ?? [])),
        createdAt: serverTimestamp(),
      }).catch((e) => {
        clearTimeout(timer)
        unsubscribe()
        reject(e)
      })
    })
  }

  destroy() {
    this.destroyed = true
    if (this.unsubscribeRoom) this.unsubscribeRoom()
    clearInterval(this._heartbeatCheckTimer)
    clearTimeout(this._connectTimeoutTimer)
  }

  _checkHeartbeat() {
    if (this.destroyed || !this.connected) return
    if (this.lastHeartbeatAt && Date.now() - this.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
      this.connected = false
      this.onConnectionStatus('host-disconnected')
    }
  }
}
