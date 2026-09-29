import { defineStore } from 'pinia'
import { watchEffect } from 'vue'
import * as roomLib from '../lib/room.js'
import { GAME_ACTION_NAMES } from '../lib/sync/protocol.js'
import { useAuthStore } from './auth.js'

const gameActionMethods = Object.fromEntries(
  GAME_ACTION_NAMES.map((name) => [
    name,
    async function (...args) {
      await roomLib[name](this.code, ...args)
    },
  ]),
)

export const useRoomStore = defineStore('room', {
  state: () => ({
    code: null,
    lobbyDoc: null, // raw Firestore room doc: code/hostUid/status/players/mode/...
    liveGame: null, // { status, game } sourced from the host/peer sync session
    connectionStatus: 'idle', // idle | connecting | connected | host-disconnected | connect-failed
    unsubscribeLobby: null,
    stopSessionWatch: null,
    sessionActive: false,
    error: null,
  }),
  getters: {
    // Merged view the UI reads. `status` can come from Firestore (the host
    // mirrors it there so joinRoom's "already started" check still works)
    // before `game` has arrived via the sync session — e.g. right after a
    // reload, before the first snapshot lands. RoomView guards on `game`
    // itself, not just `status`, before ever mounting GameBoard.
    room: (state) =>
      state.lobbyDoc && {
        ...state.lobbyDoc,
        status: state.liveGame?.status ?? state.lobbyDoc.status,
        game: state.liveGame?.game ?? null,
      },
    game: (state) => state.liveGame?.game ?? null,
    players: (state) => state.lobbyDoc?.players ?? [],
    isHost: (state) => (uid) => state.lobbyDoc?.hostUid === uid,
  },
  actions: {
    async create({ uid, name, targetScore, mode, mercyLimit, jumpInEnabled }) {
      const code = await roomLib.createRoom({ uid, name, targetScore, mode, mercyLimit, jumpInEnabled })
      this.watch(code)
      return code
    },
    async join({ code, uid, name }) {
      const cleanCode = await roomLib.joinRoom({ code, uid, name })
      this.watch(cleanCode)
      return cleanCode
    },
    // Discord Activities: bind straight to the shared activity instance
    // instead of a typed/shared invite code — see roomLib.ensureDiscordRoom.
    async autoJoinDiscord({ code, uid, name }) {
      const finalCode = await roomLib.ensureDiscordRoom({ code, uid, name })
      this.watch(finalCode)
      return finalCode
    },
    watch(code) {
      this.stopWatching()
      this.code = code.toUpperCase()
      this.error = null
      this.unsubscribeLobby = roomLib.subscribeRoom(
        this.code,
        (doc) => {
          this.lobbyDoc = doc
          if (doc) {
            roomLib.syncSessionConfig(doc)
          }
        },
        (err) => {
          this.error = err.message
        },
      )
      this.stopSessionWatch = watchEffect(() => {
        const auth = useAuthStore()
        const uid = auth.uid
        if (this.sessionActive || !uid || !this.lobbyDoc) return
        const isMember = this.lobbyDoc.players.some((p) => p.uid === uid)
        if (!isMember) return
        this.sessionActive = true
        const isHost = this.lobbyDoc.hostUid === uid
        roomLib.connectSession({
          code: this.code,
          uid,
          isHost,
          onGameState: (status, game) => {
            this.liveGame = { status, game }
          },
          onConnectionStatus: (status) => {
            this.connectionStatus = status
          },
        })
        // The lobby snapshot that brought us here may have already fired
        // (and no-opped) before the session existed to receive it — push
        // the current lobby doc in now instead of waiting for the next
        // Firestore change, which might never come before startGame.
        if (isHost) {
          roomLib.syncSessionConfig(this.lobbyDoc)
        }
      })
    },
    stopWatching() {
      if (this.unsubscribeLobby) this.unsubscribeLobby()
      if (this.stopSessionWatch) this.stopSessionWatch()
      roomLib.disconnectSession()
      this.code = null
      this.lobbyDoc = null
      this.liveGame = null
      this.connectionStatus = 'idle'
      this.unsubscribeLobby = null
      this.stopSessionWatch = null
      this.sessionActive = false
    },
    async leave(uid) {
      if (this.code) await roomLib.leaveRoom({ code: this.code, uid })
      this.stopWatching()
    },
    async updateSettings(patch) {
      await roomLib.updateRoomSettings({ code: this.code, ...patch })
    },
    async startGame(hostUid) {
      await roomLib.startGame({ hostUid })
    },
    async startNextRound() {
      await roomLib.startNextRound()
    },
    async returnToLobby() {
      await roomLib.returnToLobby()
    },
    ...gameActionMethods,
  },
})
