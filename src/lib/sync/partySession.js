// One session type for everyone — the engine is authoritative on the
// PartyKit server (party/uno.js) now, not in any player's browser, so there's
// no more host/peer distinction to maintain. Only the room's designated host
// (see WaitingRoom.vue's isHost gate) forwards ruleset/roster updates; the
// server keeps running the room regardless of who's actually connected.
import PartySocket from 'partysocket'
import { REQUEST_TIMEOUT_MS } from './protocol.js'

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999'

const CONNECT_TIMEOUT_MS = 15000
// PartySocket already retries the WebSocket itself with backoff — this is
// just how long we let it keep trying before surfacing a terminal error.
const RECONNECT_TIMEOUT_MS = 20000

export class PartySession {
  constructor({ code, uid, isHost, onStateChange, onConnectionStatus }) {
    this.uid = uid
    this.isHost = isHost
    this.onStateChange = onStateChange
    this.onConnectionStatus = onConnectionStatus || (() => {})
    this.pending = new Map() // requestId -> { resolve, reject, timer }
    this.everConnected = false
    this.destroyed = false

    this.onConnectionStatus('connecting')
    this.socket = new PartySocket({ host: PARTYKIT_HOST, room: code })

    this.socket.addEventListener('open', () => {
      this.everConnected = true
      clearTimeout(this._connectTimer)
      clearTimeout(this._dropTimer)
      this.onConnectionStatus('connected')
    })
    this.socket.addEventListener('close', () => {
      if (this.destroyed || !this.everConnected) return
      this._dropTimer = setTimeout(() => {
        if (!this.destroyed) this.onConnectionStatus('host-disconnected')
      }, RECONNECT_TIMEOUT_MS)
    })
    this.socket.addEventListener('message', (e) => this._handleMessage(e.data))

    this._connectTimer = setTimeout(() => {
      if (!this.destroyed && !this.everConnected) this.onConnectionStatus('connect-failed')
    }, CONNECT_TIMEOUT_MS)
  }

  // Pushes the room's ruleset + roster to the server — the only way it
  // learns either, since the server itself never touches Firestore.
  updateConfig(lobbyDoc) {
    if (!this.isHost) return
    this.socket.send(
      JSON.stringify({
        type: 'config',
        config: {
          mode: lobbyDoc.mode,
          targetScore: lobbyDoc.targetScore,
          mercyLimit: lobbyDoc.mercyLimit,
          jumpInEnabled: lobbyDoc.jumpInEnabled,
        },
        players: lobbyDoc.players,
      }),
    )
  }

  dispatch(actionName, args) {
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Lost connection to the game server. Your move may not have gone through.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(requestId, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ v: 1, type: 'action', requestId, action: actionName, args }))
    })
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this._connectTimer)
    clearTimeout(this._dropTimer)
    for (const p of this.pending.values()) clearTimeout(p.timer)
    this.pending.clear()
    this.socket.close()
  }

  _handleMessage(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type === 'state') {
      this.onStateChange(msg.status, msg.game)
    } else if (msg.type === 'action-result') {
      const pending = this.pending.get(msg.requestId)
      if (!pending) return
      this.pending.delete(msg.requestId)
      clearTimeout(pending.timer)
      if (msg.ok) pending.resolve()
      else pending.reject(new Error(msg.message || 'The server rejected that action.'))
    }
  }
}
