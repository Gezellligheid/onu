<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import * as engine from '../lib/uno/engine.js'
import { sfx, unlockAudio, isMuted, setMuted } from '../lib/sound.js'
import PlayingCard from './PlayingCard.vue'
import PlayerBadge from './PlayerBadge.vue'
import ColorPickerModal from './ColorPickerModal.vue'
import RoundSummaryModal from './RoundSummaryModal.vue'
import { COLOR_HEX, COLORS } from '../lib/uno/constants.js'

const AFK_SECONDS = 10

const auth = useAuthStore()
const roomStore = useRoomStore()

const uid = computed(() => auth.uid)
const room = computed(() => roomStore.room)
const game = computed(() => roomStore.game)

const muted = ref(isMuted())
function toggleMute() {
  setMuted(!muted.value)
  muted.value = isMuted()
}

const toast = ref('')
const shakeHand = ref(false)
let toastTimer = null
function flashError(err) {
  toast.value = err?.message || String(err)
  shakeHand.value = true
  sfx.invalid()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
  setTimeout(() => (shakeHand.value = false), 400)
}

const myHand = computed(() => game.value.hands[uid.value] || [])
const top = computed(() => engine.topCard(game.value))
const myTurn = computed(() => engine.isMyTurn(game.value, uid.value))
const actionable = computed(() => (game.value ? engine.actionableUid(game.value) : null))
const awaitingMyDrawDecision = computed(() => game.value.awaitingDrawDecision === uid.value)
const drawnCardId = computed(() => (awaitingMyDrawDecision.value ? myHand.value[myHand.value.length - 1]?.id : null))
const startingColorChoiceIsMine = computed(() => game.value.pendingColorChoice === uid.value)
const pendingDraw = computed(() => game.value.pendingDraw)
const mustRespondToStack = computed(() => !!pendingDraw.value && actionable.value === uid.value)

function isCardPlayable(card) {
  if (game.value.status !== 'playing' || game.value.pendingColorChoice) return false
  if (!myTurn.value) return false
  if (awaitingMyDrawDecision.value) return card.id === drawnCardId.value && engine.isPlayableNow(card, game.value)
  return engine.isPlayableNow(card, game.value)
}

const noPlayableCards = computed(() => {
  if (!myTurn.value || awaitingMyDrawDecision.value || game.value.pendingColorChoice) return false
  return myHand.value.every((c) => !engine.isPlayableNow(c, game.value))
})

const drawPileLabel = computed(() => {
  if (mustRespondToStack.value) return `Draw ${pendingDraw.value.count}!`
  if (noPlayableCards.value) return 'Draw!'
  return `${game.value.drawPile.length} left`
})

const turnBannerText = computed(() => {
  const g = game.value
  const nameOf = (id) => g.players.find((p) => p.uid === id)?.name ?? 'Player'
  if (g.pendingColorChoice) {
    return g.pendingColorChoice === uid.value ? 'Choose a color!' : `${nameOf(g.pendingColorChoice)} is choosing a color…`
  }
  if (g.pendingDraw) {
    const target = g.awaitingDrawDecision ? g.awaitingDrawDecision : g.playerOrder[g.currentIndex]
    return target === uid.value
      ? `Stack a matching +${g.pendingDraw.type === 'wild4' ? '4' : '2'} or draw ${g.pendingDraw.count}!`
      : `${nameOf(target)} must respond to the +${g.pendingDraw.count} stack!`
  }
  if (g.awaitingDrawDecision) {
    return g.awaitingDrawDecision === uid.value ? 'Play your card or pass' : `${nameOf(g.awaitingDrawDecision)} is deciding…`
  }
  const cur = g.playerOrder[g.currentIndex]
  return cur === uid.value ? 'Your turn' : `${nameOf(cur)}'s turn`
})

const opponents = computed(() => game.value.playerOrder.filter((id) => id !== uid.value).map((id) => playerInfo(id)))

function playerInfo(id) {
  const p = game.value.players.find((pl) => pl.uid === id)
  return {
    uid: id,
    name: p?.name ?? 'Player',
    score: game.value.scores[id] ?? 0,
    cardCount: game.value.hands[id]?.length ?? 0,
    isTurn: actionable.value === id,
    vulnerable: (game.value.hands[id]?.length ?? 0) === 1 && !game.value.unoCalled[id],
    waitingOn: !!pendingDraw.value && actionable.value === id,
  }
}

// Seat opponents in an arc across the top of the table, like sitting around
// it at home — "me" occupies the near/bottom edge.
const opponentSeats = computed(() => {
  const list = opponents.value
  const n = list.length
  if (n === 0) return []
  const spread = n === 1 ? 0 : Math.min(150, 34 * (n - 1))
  const start = 270 - spread / 2
  const step = n === 1 ? 0 : spread / (n - 1)
  const rx = 44
  const ry = 40
  return list.map((p, i) => {
    const angleDeg = start + step * i
    const rad = (angleDeg * Math.PI) / 180
    const left = 50 + rx * Math.cos(rad)
    const top50 = 50 + ry * Math.sin(rad)
    return { ...p, style: { left: `${left}%`, top: `${top50}%` } }
  })
})

function onCardClick(card) {
  unlockAudio()
  if (!isCardPlayable(card)) return
  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCard.value = card
    return
  }
  submitPlay(card.id, null)
}

const pendingWildCard = ref(null)

async function onChooseColor(color) {
  unlockAudio()
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
  unlockAudio()
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
  unlockAudio()
  try {
    await roomStore.callUno(uid.value)
  } catch (e) {
    flashError(e)
  }
}

async function onCatch(targetId) {
  unlockAudio()
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

// ---- Sound reactions to remote/local state changes ----
let lastSeenUpdate = game.value?.updatedAt ?? null
let lastSeenTurnFor = null

watch(
  () => game.value?.updatedAt,
  () => {
    const g = game.value
    if (!g || g.updatedAt === lastSeenUpdate) return
    lastSeenUpdate = g.updatedAt

    if (g.lastDraw) {
      sfx.cardDraw(g.lastDraw.cardIds.length)
    }
    switch (g.lastAction?.type) {
      case 'play':
        sfx.cardPlay()
        break
      case 'skip':
      case 'starter-skip':
        sfx.skip()
        break
      case 'reverse':
      case 'starter-reverse':
        sfx.reverse()
        break
      case 'stack-draw2':
      case 'stack-wild4':
        sfx.stack()
        break
      case 'wild':
        sfx.wild()
        break
      case 'uno-call':
        sfx.unoCall()
        break
      case 'uno-caught':
        sfx.caught()
        break
      case 'pass':
      case 'color-chosen':
        sfx.click()
        break
      case 'round-over':
        if (g.status === 'game-over') sfx.gameWin()
        else sfx.roundWin()
        break
      default:
        break
    }
  },
)

watch(actionable, (id) => {
  if (id && id === uid.value && lastSeenTurnFor !== id) {
    sfx.turnYours()
  }
  lastSeenTurnFor = id
})

// ---- AFK auto-play: if nobody acts within AFK_SECONDS, play a random legal move ----
const afkSecondsLeft = ref(null)
let afkTimeout = null
let afkInterval = null

function clearAfk() {
  if (afkTimeout) clearTimeout(afkTimeout)
  if (afkInterval) clearInterval(afkInterval)
  afkTimeout = null
  afkInterval = null
  afkSecondsLeft.value = null
}

function pickRandomAutoAction(g, actUid) {
  if (g.pendingColorChoice === actUid) {
    return { kind: 'color', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  }
  if (g.awaitingDrawDecision === actUid) {
    const hand = g.hands[actUid]
    const drawn = hand[hand.length - 1]
    const options = [{ kind: 'pass' }]
    if (drawn && engine.isPlayableNow(drawn, g)) options.push({ kind: 'play', card: drawn })
    return options[Math.floor(Math.random() * options.length)]
  }
  const hand = g.hands[actUid] || []
  const options = hand.filter((c) => engine.isPlayableNow(c, g)).map((c) => ({ kind: 'play', card: c }))
  options.push({ kind: 'draw' })
  return options[Math.floor(Math.random() * options.length)]
}

async function performAutoAction(actUid) {
  const g = game.value
  if (!g) return
  const action = pickRandomAutoAction(g, actUid)
  try {
    if (action.kind === 'color') await roomStore.chooseStarterColor(actUid, action.color)
    else if (action.kind === 'pass') await roomStore.passTurn(actUid)
    else if (action.kind === 'draw') await roomStore.drawCard(actUid)
    else if (action.kind === 'play') {
      const color =
        action.card.type === 'wild' || action.card.type === 'wild4'
          ? COLORS[Math.floor(Math.random() * COLORS.length)]
          : null
      await roomStore.playCard(actUid, action.card.id, color)
    }
    sfx.autoPlay()
  } catch {
    // Another client likely already acted for this player — ignore the race.
  }
}

watch(
  () => [actionable.value, game.value?.updatedAt],
  () => {
    clearAfk()
    const g = game.value
    const target = actionable.value
    if (!target || !g || g.status !== 'playing') return
    const startedAt = g.updatedAt
    afkSecondsLeft.value = AFK_SECONDS
    afkInterval = setInterval(() => {
      if (afkSecondsLeft.value !== null) afkSecondsLeft.value -= 1
    }, 1000)
    afkTimeout = setTimeout(() => {
      clearAfk()
      const cur = game.value
      if (cur && cur.updatedAt === startedAt && engine.actionableUid(cur) === target) {
        performAutoAction(target)
      }
    }, AFK_SECONDS * 1000)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearAfk()
  clearTimeout(toastTimer)
})
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-5xl flex-col px-3 py-4">
    <div class="mb-2 flex items-center justify-between text-xs text-slate-500">
      <span>Room <span class="font-semibold text-slate-300">{{ room.code }}</span></span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-white/10 px-2 py-1 hover:border-white/20"
          @click="toggleMute"
        >
          {{ muted ? '🔇 Muted' : '🔊 Sound' }}
        </button>
        <button type="button" class="rounded-md border border-white/10 px-2 py-1 hover:border-white/20" @click="onLeave">
          Leave
        </button>
      </div>
    </div>

    <!-- Round table -->
    <div
      class="relative mb-3 w-full rounded-[3rem] border border-white/5 bg-gradient-to-b from-emerald-950/40 to-slate-950/40 transition-shadow"
      :class="myTurn ? 'shadow-[0_0_0_2px_rgba(250,204,21,0.35),0_0_40px_rgba(250,204,21,0.12)]' : ''"
      style="aspect-ratio: 16 / 11"
    >
      <div
        v-for="p in opponentSeats"
        :key="p.uid"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="p.style"
      >
        <PlayerBadge
          :name="p.name"
          :card-count="p.cardCount"
          :is-turn="p.isTurn"
          :score="p.score"
          :vulnerable="p.vulnerable"
          :can-catch="p.vulnerable"
          :waiting-on="p.waitingOn"
          @catch="onCatch(p.uid)"
        />
      </div>

      <!-- Center: piles + turn/stack banners -->
      <div class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <p
          class="rounded-full px-3 py-1 text-center font-display text-sm font-semibold shadow"
          :class="
            pendingDraw
              ? 'bg-uno-red/90 text-white animate-pulse'
              : myTurn
                ? 'bg-uno-yellow text-uno-black'
                : 'bg-slate-800/90 text-slate-300'
          "
        >
          {{ turnBannerText }}
          <span class="ml-1">{{ game.direction === 1 ? '↻' : '↺' }}</span>
          <span v-if="afkSecondsLeft !== null && afkSecondsLeft <= 5" class="ml-1 opacity-80">
            (auto in {{ afkSecondsLeft }}s)
          </span>
        </p>

        <div class="flex items-center gap-5">
          <button type="button" class="flex flex-col items-center gap-1" @click="onDrawPile">
            <PlayingCard
              :card="null"
              size="lg"
              :playable="myTurn && !awaitingMyDrawDecision"
              :glow="noPlayableCards && !mustRespondToStack"
              :urgent="mustRespondToStack"
              animate-in="pop"
              :key="game.drawPile.length"
            />
            <span
              class="text-[11px]"
              :class="mustRespondToStack ? 'font-bold text-uno-red' : noPlayableCards ? 'font-bold text-uno-yellow' : 'text-slate-500'"
            >
              {{ drawPileLabel }}
            </span>
          </button>

          <div class="flex flex-col items-center gap-1">
            <div class="relative rounded-xl" :style="{ boxShadow: `0 0 0 3px ${COLOR_HEX[game.currentColor]}` }">
              <PlayingCard :card="top" size="lg" animate-in="flip" :key="top?.id" />
            </div>
            <span class="text-[11px] capitalize text-slate-500">{{ game.currentColor }}</span>
          </div>
        </div>

        <button
          v-if="awaitingMyDrawDecision"
          type="button"
          class="animate-pop rounded-lg border border-white/20 px-4 py-1.5 text-sm font-medium text-slate-300 hover:border-white/40"
          @click="onPass"
        >
          Pass turn
        </button>
      </div>
    </div>

    <p v-if="game.lastAction?.message" class="mb-2 text-center text-xs text-slate-500">
      {{ game.lastAction.message }}
    </p>

    <!-- My hand -->
    <div class="relative rounded-2xl border border-white/5 bg-white/[0.03] p-3" :class="shakeHand ? 'animate-shake' : ''">
      <div
        v-if="!myTurn && game.status === 'playing'"
        class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/40 text-xs font-medium text-slate-400"
      >
        Waiting for {{ turnBannerText }}
      </div>
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
          v-for="(card, idx) in myHand"
          :key="card.id"
          :card="card"
          :playable="isCardPlayable(card)"
          :disabled="!isCardPlayable(card)"
          :glow="isCardPlayable(card) && !pendingDraw"
          :urgent="isCardPlayable(card) && !!pendingDraw"
          animate-in="deal"
          :style="{ animationDelay: `${idx * 35}ms` }"
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
