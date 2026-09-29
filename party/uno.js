// Authoritative UNO engine, running once per room on Cloudflare (via
// partyserver, deployed with Wrangler) instead of any single player's
// browser — see src/lib/sync/partySession.js for the client. Firebase/
// Firestore still owns the lobby (create/join/leave, settings, roster)
// since that's low-volume; this only ever needs the room's ruleset/roster,
// which the host forwards over the socket whenever the lobby doc changes
// (see PartySession#updateConfig), and the live `status`/`game`, which
// nothing outside this room needs to persist.
import { Server, routePartykitRequest } from 'partyserver'
import { PHASE_ACTION_NAMES } from '../src/lib/sync/protocol.js'
import { getEngine } from '../src/lib/uno/modes.js'
import { MIN_PLAYERS } from '../src/lib/uno/constants.js'

export class UnoServer extends Server {
  status = 'lobby'
  game = null
  config = {}
  players = []

  // Runs once when the room's Durable Object (re)starts — including after
  // it's been idle and evicted — so a room's live state survives every
  // player disconnecting, not just one player's tab closing.
  async onStart() {
    const saved = await this.ctx.storage.get('state')
    if (saved) {
      this.status = saved.status
      this.game = saved.game
      this.config = saved.config ?? {}
      this.players = saved.players ?? []
    }
  }

  onConnect(connection) {
    connection.send(JSON.stringify({ type: 'state', status: this.status, game: this.game }))
  }

  async onMessage(sender, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.type === 'config') {
      this.config = msg.config
      this.players = msg.players
      await this._persist()
      return
    }

    if (msg.type !== 'action') return
    let result
    try {
      this._applyAction(msg.action, msg.args)
      result = { ok: true }
    } catch (e) {
      result = { ok: false, message: e.message }
    }
    sender.send(JSON.stringify({ v: 1, type: 'action-result', requestId: msg.requestId, ...result }))
    if (result.ok) {
      await this._persist()
      this.broadcast(JSON.stringify({ type: 'state', status: this.status, game: this.game }))
    }
  }

  // ---- engine dispatch (unchanged from the Firestore-transport version) ----

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
      this.game = engine.startNextRound(this.game, this.players)
      this.status = 'playing'
    } else if (actionName === 'returnToLobby') {
      this.game = null
      this.status = 'lobby'
    }
  }

  _persist() {
    return this.ctx.storage.put('state', {
      status: this.status,
      game: this.game,
      config: this.config,
      players: this.players,
    })
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) || new Response('Not found', { status: 404 })
  },
}
