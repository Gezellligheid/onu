import { defineStore } from 'pinia'
import * as roomLib from '../lib/room.js'

export const useRoomStore = defineStore('room', {
  state: () => ({
    code: null,
    room: null,
    unsubscribe: null,
    error: null,
  }),
  getters: {
    game: (state) => state.room?.game ?? null,
    players: (state) => state.room?.players ?? [],
    isHost: (state) => (uid) => state.room?.hostUid === uid,
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
    watch(code) {
      this.stopWatching()
      this.code = code.toUpperCase()
      this.error = null
      this.unsubscribe = roomLib.subscribeRoom(
        this.code,
        (room) => {
          this.room = room
        },
        (err) => {
          this.error = err.message
        },
      )
    },
    stopWatching() {
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = null
      this.room = null
      this.code = null
    },
    async leave(uid) {
      if (this.code) await roomLib.leaveRoom({ code: this.code, uid })
      this.stopWatching()
    },
    async startGame(hostUid) {
      await roomLib.startGame({ code: this.code, hostUid })
    },
    async playCard(uid, cardId, chosenColor, swapTargetUid) {
      await roomLib.playCard(this.code, uid, cardId, chosenColor, swapTargetUid)
    },
    async jumpIn(uid, cardId, chosenColor, swapTargetUid) {
      await roomLib.jumpIn(this.code, uid, cardId, chosenColor, swapTargetUid)
    },
    async drawCard(uid) {
      await roomLib.drawCard(this.code, uid)
    },
    async passTurn(uid) {
      await roomLib.passTurn(this.code, uid)
    },
    async callUno(uid) {
      await roomLib.callUno(this.code, uid)
    },
    async catchUno(catcherId, targetId) {
      await roomLib.catchUno(this.code, catcherId, targetId)
    },
    async chooseStarterColor(uid, color) {
      await roomLib.chooseStarterColor(this.code, uid, color)
    },
    async chooseRouletteColor(uid, color) {
      await roomLib.chooseRouletteColor(this.code, uid, color)
    },
    async startNextRound() {
      await roomLib.startNextRound(this.code)
    },
    async returnToLobby() {
      await roomLib.returnToLobby(this.code)
    },
  },
})
