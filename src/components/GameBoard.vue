<script setup>
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import * as engine from '../lib/uno/engine.js'
import PlayingCard from './PlayingCard.vue'
import PlayerBadge from './PlayerBadge.vue'
import ColorPickerModal from './ColorPickerModal.vue'
import RoundSummaryModal from './RoundSummaryModal.vue'
import { COLOR_HEX } from '../lib/uno/constants.js'

const auth = useAuthStore()
const roomStore = useRoomStore()

const uid = computed(() => auth.uid)
const room = computed(() => roomStore.room)
const game = computed(() => roomStore.game)

const toast = ref('')
let toastTimer = null
function flashError(err) {
  toast.value = err?.message || String(err)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

const myHand = computed(() => game.value.hands[uid.value] || [])
const top = computed(() => engine.topCard(game.value))
const myTurn = computed(() => engine.isMyTurn(game.value, uid.value))
const awaitingMyDrawDecision = computed(() => game.value.awaitingDrawDecision === uid.value)
const drawnCardId = computed(() => (awaitingMyDrawDecision.value ? myHand.value[myHand.value.length - 1]?.id : null))
const startingColorChoiceIsMine = computed(() => game.value.pendingColorChoice === uid.value)

function isCardPlayable(card) {
  if (!myTurn.value || game.value.status !== 'playing' || game.value.pendingColorChoice) return false
  if (awaitingMyDrawDecision.value) return card.id === drawnCardId.value
  return engine.isPlayable(card, top.value, game.value.currentColor)
}

const opponents = computed(() => game.value.playerOrder.filter((id) => id !== uid.value).map((id) => playerInfo(id)))

function playerInfo(id) {
  const p = game.value.players.find((pl) => pl.uid === id)
  return {
    uid: id,
    name: p?.name ?? 'Player',
    score: game.value.scores[id] ?? 0,
    cardCount: game.value.hands[id]?.length ?? 0,
    isTurn: game.value.playerOrder[game.value.currentIndex] === id,
    vulnerable: (game.value.hands[id]?.length ?? 0) === 1 && !game.value.unoCalled[id],
  }
}

const pendingWildCard = ref(null)
function onCardClick(card) {
  if (!isCardPlayable(card)) return
  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCard.value = card
    return
  }
  submitPlay(card.id, null)
}

async function onChooseColor(color) {
  if (startingColorChoiceIsMine.value) {
    try {
      await roomStore.chooseStarterColor(uid.value, color)
    } catch (e) {
      flashError(e)
    }
    return
  }
  const card = pendingWildCard.value
  pendingWildCard.value = null
  await submitPlay(card.id, color)
}

async function submitPlay(cardId, color) {
  try {
    await roomStore.playCard(uid.value, cardId, color)
  } catch (e) {
    flashError(e)
  }
}

async function onDrawPile() {
  if (!myTurn.value || awaitingMyDrawDecision.value || game.value.pendingColorChoice) return
  try {
    await roomStore.drawCard(uid.value)
  } catch (e) {
    flashError(e)
  }
}

async function onPass() {
  try {
    await roomStore.passTurn(uid.value)
  } catch (e) {
    flashError(e)
  }
}

const showUnoButton = computed(() => myHand.value.length <= 2 && myHand.value.length >= 1 && !game.value.unoCalled[uid.value])
async function onCallUno() {
  try {
    await roomStore.callUno(uid.value)
  } catch (e) {
    flashError(e)
  }
}

async function onCatch(targetId) {
  try {
    await roomStore.catchUno(uid.value, targetId)
  } catch (e) {
    flashError(e)
  }
}

async function onNextRound() {
  try {
    await roomStore.startNextRound()
  } catch (e) {
    flashError(e)
  }
}

async function onBackToLobby() {
  try {
    await roomStore.returnToLobby()
  } catch (e) {
    flashError(e)
  }
}

async function onLeave() {
  await roomStore.leave(uid.value)
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-4xl flex-col px-3 py-4">
    <div class="mb-3 flex items-center justify-between text-xs text-slate-500">
      <span>Room <span class="font-semibold text-slate-300">{{ room.code }}</span></span>
      <button type="button" class="rounded-md border border-white/10 px-2 py-1 hover:border-white/20" @click="onLeave">
        Leave
      </button>
    </div>

    <!-- Opponents -->
    <div class="mb-4 flex flex-wrap items-start justify-center gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <PlayerBadge
        v-for="p in opponents"
        :key="p.uid"
        :name="p.name"
        :card-count="p.cardCount"
        :is-turn="p.isTurn"
        :score="p.score"
        :vulnerable="p.vulnerable"
        :can-catch="p.vulnerable"
        @catch="onCatch(p.uid)"
      />
    </div>

    <!-- Center table -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 py-6">
      <p class="font-display text-sm font-semibold" :class="myTurn ? 'text-uno-yellow' : 'text-slate-500'">
        {{ myTurn ? "Your turn" : `${game.players.find(p => p.uid === game.playerOrder[game.currentIndex])?.name}'s turn` }}
        <span class="ml-1 text-slate-600">{{ game.direction === 1 ? '↻' : '↺' }}</span>
      </p>

      <div class="flex items-center gap-6">
        <button type="button" class="flex flex-col items-center gap-1" @click="onDrawPile">
          <PlayingCard :card="null" size="lg" :playable="myTurn && !awaitingMyDrawDecision" />
          <span class="text-[11px] text-slate-500">{{ game.drawPile.length }} left</span>
        </button>

        <div class="flex flex-col items-center gap-1">
          <div class="relative rounded-xl" :style="{ boxShadow: `0 0 0 3px ${COLOR_HEX[game.currentColor]}` }">
            <PlayingCard :card="top" size="lg" />
          </div>
          <span class="text-[11px] capitalize text-slate-500">{{ game.currentColor }}</span>
        </div>
      </div>

      <button
        v-if="awaitingMyDrawDecision"
        type="button"
        class="rounded-lg border border-white/20 px-4 py-1.5 text-sm font-medium text-slate-300 hover:border-white/40"
        @click="onPass"
      >
        Pass turn
      </button>

      <p v-if="game.lastAction?.message" class="max-w-sm text-center text-xs text-slate-500">
        {{ game.lastAction.message }}
      </p>
    </div>

    <!-- My hand -->
    <div class="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
      <div class="mb-2 flex items-center justify-between px-1">
        <span class="text-xs text-slate-500">Your hand ({{ myHand.length }})</span>
        <button
          v-if="showUnoButton"
          type="button"
          class="animate-pulse-glow rounded-full bg-uno-red px-3 py-1 text-xs font-bold text-white shadow"
          @click="onCallUno"
        >
          UNO!
        </button>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1">
        <PlayingCard
          v-for="card in myHand"
          :key="card.id"
          :card="card"
          :playable="isCardPlayable(card)"
          :disabled="!isCardPlayable(card)"
          @click="onCardClick(card)"
        />
      </div>
    </div>

    <transition name="fade">
      <div
        v-if="toast"
        class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-2 text-sm font-medium text-white shadow-xl"
      >
        {{ toast }}
      </div>
    </transition>

    <ColorPickerModal :show="!!pendingWildCard || startingColorChoiceIsMine" @choose="onChooseColor" />

    <RoundSummaryModal
      v-if="game.status === 'round-over' || game.status === 'game-over'"
      :game="game"
      :is-host="room.hostUid === uid"
      @next-round="onNextRound"
      @back-to-lobby="onBackToLobby"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
