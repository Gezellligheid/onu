<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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

// Display-only sort (color, then rank) so your hand stays organized as you
// draw/play — the underlying array order (which drawnCardId relies on to
// find "the card I just drew") is untouched.
const HAND_SORT_COLOR = { red: 0, yellow: 1, green: 2, blue: 3, black: 4 }
const HAND_SORT_TYPE = { number: 0, skip: 1, reverse: 2, draw2: 3, wild: 4, wild4: 5 }
const sortedHand = computed(() =>
  [...myHand.value].sort((a, b) => {
    const byColor = HAND_SORT_COLOR[a.color] - HAND_SORT_COLOR[b.color]
    if (byColor !== 0) return byColor
    const byType = HAND_SORT_TYPE[a.type] - HAND_SORT_TYPE[b.type]
    if (byType !== 0) return byType
    return a.type === 'number' ? a.value - b.value : 0
  }),
)
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

// Your own hand fans out in a slight arc, center raised — like cards held
// in two hands — instead of a flat overlapping row. The arc widens as you
// draw more cards (using up to the full screen width), and only starts
// getting denser once it would otherwise run off the edge of the screen.
const HAND_MAX_SPACING = 81
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
function onResize() {
  viewportWidth.value = window.innerWidth
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const handAvailableWidth = computed(() => Math.max(240, viewportWidth.value - 48))

function handSpacing(total) {
  if (total <= 1) return HAND_MAX_SPACING
  return Math.min(HAND_MAX_SPACING, handAvailableWidth.value / (total - 1))
}
function handCardStyle(i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)', zIndex: i }
  const mid = (total - 1) / 2
  const offset = i - mid
  const spacing = handSpacing(total)
  const rotate = offset * Math.min(6, 46 / total)
  const x = offset * spacing
  const y = offset * offset * Math.min(3.4, 22 / total)
  return {
    transform: `translateX(calc(-50% + ${x}px)) translateY(${y}px) rotate(${rotate}deg)`,
    zIndex: i,
  }
}
const handFanWidth = computed(() => {
  const n = myHand.value.length
  return Math.max(n - 1, 0) * handSpacing(n) + 160
})

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

// Rotated relative to MY OWN seat so every viewer sees the same mental
// model: the first opponent seat is always whoever plays right after me,
// then the next, wrapping back around to just before me. Without this
// rotation, two different players would see the table arranged
// differently and the direction arrow would stop meaning the same thing
// for everyone.
const opponents = computed(() => {
  const order = game.value.playerOrder
  const n = order.length
  const myIdx = order.indexOf(uid.value)
  if (myIdx === -1) return order.map((id) => playerInfo(id))
  const rotated = []
  for (let i = 1; i < n; i += 1) rotated.push(order[(myIdx + i) % n])
  return rotated.map((id) => playerInfo(id))
})

function playerInfo(id) {
  const p = game.value.players.find((pl) => pl.uid === id)
  return {
    uid: id,
    name: p?.name ?? 'Player',
    cards: game.value.hands[id] || [],
    score: game.value.scores[id] ?? 0,
    isTurn: actionable.value === id,
    vulnerable: (game.value.hands[id]?.length ?? 0) === 1 && !game.value.unoCalled[id],
    waitingOn: !!pendingDraw.value && actionable.value === id,
  }
}

// Seats are FIXED around the table in turn order, "me" at the near/bottom
// edge — exactly like sitting around a real table. Going around the arc in
// seat order traces the play order; the direction arrow (below) shows which
// way that currently flows, since Reverse flips the direction, not the seats.
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

// ---- Decorative circular direction arrow around the piles ----
function ellipseArcPath(cx, cy, rx, ry, startDeg, endDeg) {
  const toXY = (deg) => {
    const rad = (deg * Math.PI) / 180
    return [cx + rx * Math.cos(rad), cy + ry * Math.sin(rad)]
  }
  const [sx, sy] = toXY(startDeg)
  const [ex, ey] = toXY(endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${sx} ${sy} A ${rx} ${ry} 0 ${large} 1 ${ex} ${ey}`
}
function arrowHeadPoints(cx, cy, rx, ry, endDeg, size = 13) {
  const rad = (endDeg * Math.PI) / 180
  const ex = cx + rx * Math.cos(rad)
  const ey = cy + ry * Math.sin(rad)
  const tx = -rx * Math.sin(rad)
  const ty = ry * Math.cos(rad)
  const len = Math.hypot(tx, ty) || 1
  const ux = tx / len
  const uy = ty / len
  const nx = -uy
  const ny = ux
  const tipX = ex + ux * size
  const tipY = ey + uy * size
  const b1x = ex + nx * size * 0.55
  const b1y = ey + ny * size * 0.55
  const b2x = ex - nx * size * 0.55
  const b2y = ey - ny * size * 0.55
  return `${tipX},${tipY} ${b1x},${b1y} ${b2x},${b2y}`
}
const DIR_CX = 220
const DIR_CY = 140
const DIR_RX = 206
const DIR_RY = 129
const directionArcPath = ellipseArcPath(DIR_CX, DIR_CY, DIR_RX, DIR_RY, -35, 250)
const directionArrowPoints = arrowHeadPoints(DIR_CX, DIR_CY, DIR_RX, DIR_RY, 250, 38)

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

// ---- Flying-card animations: a lightweight overlay of "cloned" cards that
// animate from one DOM element's position to another's, then vanish once the
// real state has settled underneath. ----
const discardPileEl = ref(null)
const drawPileEl = ref(null)
const myHandEl = ref(null)
const seatEls = {}
function setSeatRef(id, el) {
  if (el) seatEls[id] = el
  else delete seatEls[id]
}

// Natural on-screen pixel width each endpoint's cards actually render at —
// used to size the flying clone correctly. Deriving this from the
// destination element's own bounding box was the bug: the hand row and
// discard/draw wrappers are wider than a single card, so a "fly to hand"
// animation would balloon up to the width of the whole hand panel instead
// of landing at normal card size.
const HAND_CARD_PX = 134 // matches PlayingCard size="xl" used for my own hand
const SEAT_CARD_PX = 40 // matches CardFan's size="sm"
const PILE_CARD_PX = 112 // matches PlayingCard size="lg" used for the piles

function endpointFor(playerUid) {
  if (playerUid === uid.value) return { el: myHandEl.value, size: HAND_CARD_PX, alignLeft: false }
  return { el: seatEls[playerUid] || null, size: SEAT_CARD_PX, alignLeft: false }
}

const flying = ref([])
const CARD_NATURAL_W = 64
const CARD_NATURAL_H = 96

function anchorPoint(rect, size, alignLeft) {
  // For the hand row (much wider than one card, content left-aligned), land
  // near its left edge rather than its true center; everything else is
  // small enough that the element's own center is a fine target.
  const x = alignLeft ? rect.left + Math.min(rect.width, 70) : rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  return { x, y }
}

function spawnFly(from, to, card) {
  if (!from.el || !to.el) return
  const fromRect = from.el.getBoundingClientRect()
  const toRect = to.el.getBoundingClientRect()
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const startScale = from.size / CARD_NATURAL_W
  const endScale = to.size / CARD_NATURAL_W
  const start = anchorPoint(fromRect, from.size, from.alignLeft)
  const end = anchorPoint(toRect, to.size, to.alignLeft)
  const startX = start.x - CARD_NATURAL_W / 2
  const startY = start.y - CARD_NATURAL_H / 2
  const endX = end.x - CARD_NATURAL_W / 2
  const endY = end.y - CARD_NATURAL_H / 2

  const item = reactive({
    id,
    card,
    style: {
      transform: `translate(${startX}px, ${startY}px) scale(${startScale})`,
      transition: 'transform 380ms cubic-bezier(0.22,0.68,0.32,1), opacity 380ms ease',
      opacity: 1,
    },
  })
  flying.value.push(item)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      item.style = {
        ...item.style,
        transform: `translate(${endX}px, ${endY}px) scale(${endScale})`,
      }
    })
  })
  setTimeout(() => {
    flying.value = flying.value.filter((f) => f.id !== id)
  }, 420)
}

function spawnFlyBatch(from, to, cards, stagger = 110) {
  cards.forEach((card, i) => {
    setTimeout(() => spawnFly(from, to, card), i * stagger)
  })
}

// ---- Non-card flying labels: the "UNO!" call and the "blocked" icon.
// These don't scale to match card sizes — they're fixed-size labels that
// just travel and fade. ----
const tableCenterEl = ref(null)

function spawnLabel(from, to, kind) {
  if (!from.el || !to.el) return
  const fromRect = from.el.getBoundingClientRect()
  const toRect = to.el.getBoundingClientRect()
  const w = kind === 'uno' ? 140 : 64
  const h = kind === 'uno' ? 56 : 64
  const start = anchorPoint(fromRect, from.size, from.alignLeft)
  const end = anchorPoint(toRect, to.size, to.alignLeft)
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const item = reactive({
    id,
    kind,
    style: {
      transform: `translate(${start.x - w / 2}px, ${start.y - h / 2}px) scale(0.5)`,
      transition: 'transform 550ms cubic-bezier(0.2,0.75,0.3,1), opacity 550ms ease',
      opacity: 0,
    },
  })
  flying.value.push(item)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      item.style = {
        ...item.style,
        transform: `translate(${end.x - w / 2}px, ${end.y - h / 2}px) scale(1.15)`,
        opacity: 1,
      }
    })
  })
  setTimeout(() => {
    flying.value = flying.value.filter((f) => f.id !== id)
  }, 620)
}

// A brief, big "BLOCKED!" flash shown only to the player who got skipped.
const blockedFlash = ref(false)
let blockedFlashTimer = null
function triggerBlockedFlash() {
  blockedFlash.value = false
  requestAnimationFrame(() => {
    blockedFlash.value = true
    clearTimeout(blockedFlashTimer)
    blockedFlashTimer = setTimeout(() => (blockedFlash.value = false), 900)
  })
}

// ---- Sound + fly-animation reactions to remote/local state changes ----
let lastSeenUpdate = game.value?.updatedAt ?? null
let lastSeenTurnFor = null

const PLAY_TYPES = new Set(['play', 'skip', 'reverse', 'stack-draw2', 'stack-wild4', 'wild'])

watch(
  () => game.value?.updatedAt,
  () => {
    const g = game.value
    if (!g || g.updatedAt === lastSeenUpdate) return
    lastSeenUpdate = g.updatedAt

    if (g.lastDraw) sfx.cardDraw(g.lastDraw.cardIds.length)

    const la = g.lastAction
    switch (la?.type) {
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

    if (la?.card && PLAY_TYPES.has(la.type) && discardPileEl.value) {
      spawnFly(endpointFor(la.by), { el: discardPileEl.value, size: PILE_CARD_PX, alignLeft: false }, la.card)
    }
    if (g.lastDraw && drawPileEl.value) {
      const from = { el: drawPileEl.value, size: PILE_CARD_PX, alignLeft: false }
      spawnFlyBatch(from, endpointFor(g.lastDraw.by), g.lastDraw.cardIds.map(() => null))
    }

    if (la?.type === 'uno-call' && tableCenterEl.value) {
      spawnLabel(endpointFor(la.by), { el: tableCenterEl.value, size: 0, alignLeft: false }, 'uno')
    }

    if ((la?.type === 'skip' || la?.type === 'starter-skip') && la.target) {
      const to = endpointFor(la.target)
      if (la.by) spawnLabel(endpointFor(la.by), to, 'block')
      if (la.target === uid.value) triggerBlockedFlash()
    }
  },
)

watch(actionable, (id) => {
  if (id && id === uid.value && lastSeenTurnFor !== id) {
    sfx.turnYours()
  }
  lastSeenTurnFor = id
})

// ---- AFK auto-play: if nobody acts within AFK_SECONDS, play a random legal
// move for them so the game never stalls. Drawing still happens one card at
// a time (mirroring the manual click-per-draw flow) but without the delay
// between clicks, since at that point a human isn't engaging anyway. ----
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

async function autoDrawUntilResolved(actUid) {
  for (let guard = 0; guard < 60; guard += 1) {
    await roomStore.drawCard(actUid)
    const g = game.value
    if (!g) return
    if (g.awaitingDrawDecision === actUid) return
    if (engine.actionableUid(g) !== actUid) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function performAutoAction(actUid) {
  const g = game.value
  if (!g) return
  const action = pickRandomAutoAction(g, actUid)
  try {
    if (action.kind === 'color') await roomStore.chooseStarterColor(actUid, action.color)
    else if (action.kind === 'pass') await roomStore.passTurn(actUid)
    else if (action.kind === 'draw') await autoDrawUntilResolved(actUid)
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
  clearTimeout(blockedFlashTimer)
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
      style="aspect-ratio: 16 / 13"
    >
      <div
        v-for="p in opponentSeats"
        :key="p.uid"
        class="absolute -translate-x-1/2 -translate-y-1/2"
        :style="p.style"
        :ref="(el) => setSeatRef(p.uid, el)"
      >
        <PlayerBadge
          :name="p.name"
          :cards="p.cards"
          :is-turn="p.isTurn"
          :score="p.score"
          :vulnerable="p.vulnerable"
          :can-catch="p.vulnerable"
          :waiting-on="p.waitingOn"
          @catch="onCatch(p.uid)"
        />
      </div>

      <!-- Center: piles + turn/stack banners -->
      <div ref="tableCenterEl" class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
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
          <span v-if="afkSecondsLeft !== null && afkSecondsLeft <= 5" class="ml-1 opacity-80">
            (auto in {{ afkSecondsLeft }}s)
          </span>
        </p>

        <div class="relative flex items-center justify-center" style="width: 440px; height: 280px">
          <!-- Big circular direction arrow, mirrored when play reverses -->
          <svg
            viewBox="0 0 440 280"
            class="pointer-events-none absolute inset-0 h-full w-full transition-transform duration-500"
            :class="game.direction === -1 ? '[transform:scaleX(-1)]' : ''"
          >
            <path :d="directionArcPath" fill="none" stroke="#facc15" stroke-width="10" stroke-linecap="round" opacity="0.85" />
            <polygon :points="directionArrowPoints" fill="#facc15" opacity="1" />
          </svg>

          <div class="relative flex items-center gap-5">
            <button type="button" class="flex flex-col items-center gap-1" ref="drawPileEl" @click="onDrawPile">
              <PlayingCard
                :card="null"
                size="lg"
                :playable="myTurn && !awaitingMyDrawDecision"
                :flash="mustRespondToStack ? 'red' : noPlayableCards ? 'yellow' : ''"
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

            <div class="flex flex-col items-center gap-1" ref="discardPileEl">
              <div class="relative rounded-xl" :style="{ boxShadow: `0 0 0 3px ${COLOR_HEX[game.currentColor]}` }">
                <PlayingCard
                  :card="top"
                  size="lg"
                  animate-in="flip"
                  :tint-color="COLOR_HEX[game.currentColor]"
                  :key="top?.id"
                />
              </div>
              <span class="text-[11px] capitalize text-slate-500">{{ game.currentColor }}</span>
            </div>
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

    <!-- Spacer so page content isn't hidden behind the floating hand -->
    <div class="h-[300px]"></div>

    <!-- My hand: floats freely in front of everything, no boxed panel -->
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center pb-3" :class="shakeHand ? 'animate-shake' : ''">
      <div class="pointer-events-auto mb-1 flex items-center gap-3">
        <span class="rounded-full bg-slate-950/70 px-2 py-0.5 text-xs text-slate-400 backdrop-blur">
          {{ myTurn ? 'Your hand' : `Waiting for ${turnBannerText}` }} ({{ myHand.length }})
        </span>
        <button
          v-if="showUnoButton"
          type="button"
          class="pointer-events-auto animate-pulse-glow rounded-full bg-uno-red px-3 py-1 text-xs font-bold text-white shadow"
          @click="onCallUno"
        >
          UNO!
        </button>
      </div>
      <div class="pointer-events-auto relative" :style="{ width: `${handFanWidth}px`, height: '260px' }" ref="myHandEl">
        <div
          v-for="(card, idx) in sortedHand"
          :key="card.id"
          class="absolute left-1/2 top-4 origin-bottom transition-transform duration-300 hover:z-30"
          :style="handCardStyle(idx, sortedHand.length)"
        >
          <PlayingCard
            :card="card"
            size="xl"
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
    </div>

    <!-- Flying card / label overlay -->
    <div
      v-for="f in flying"
      :key="f.id"
      class="pointer-events-none fixed left-0 top-0 z-[60]"
      :style="f.style"
    >
      <PlayingCard v-if="!f.kind" :card="f.card" size="md" />
      <div
        v-else-if="f.kind === 'uno'"
        class="whitespace-nowrap font-display text-5xl font-extrabold text-uno-red"
        style="-webkit-text-stroke: 3px white; text-shadow: 0 4px 10px rgba(0, 0, 0, 0.7)"
      >
        UNO!
      </div>
      <div
        v-else-if="f.kind === 'block'"
        class="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-uno-red text-3xl shadow-2xl"
      >
        🚫
      </div>
    </div>

    <!-- Big "you got blocked" flash, shown only to the player who was skipped -->
    <transition name="block-flash">
      <div v-if="blockedFlash" class="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center">
        <div class="rounded-3xl border-4 border-white bg-uno-red/95 px-10 py-6 text-center shadow-2xl">
          <div class="text-6xl">🚫</div>
          <p class="mt-2 font-display text-4xl font-extrabold text-white">BLOCKED!</p>
        </div>
      </div>
    </transition>

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
.block-flash-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.block-flash-leave-active {
  transition: opacity 0.4s ease;
}
.block-flash-enter-from {
  opacity: 0;
  transform: scale(0.6);
}
.block-flash-leave-to {
  opacity: 0;
}
</style>
