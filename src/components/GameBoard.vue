<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth.js'
import { useRoomStore } from '../stores/room.js'
import { getEngine } from '../lib/uno/modes.js'
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
const isNoMercy = computed(() => game.value?.mode === 'no-mercy')
const activeEngine = computed(() => getEngine(game.value?.mode))

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
const top = computed(() => activeEngine.value.topCard(game.value))
const myTurn = computed(() => activeEngine.value.isMyTurn(game.value, uid.value))
const actionable = computed(() => (game.value ? activeEngine.value.actionableUid(game.value) : null))
// Classic-only: "keep drawn card or pass" choice. No Mercy has no pass — a
// drawn playable card is mandatory, tracked instead by pendingDrawnChoice.
const awaitingMyDrawDecision = computed(() => !isNoMercy.value && game.value.awaitingDrawDecision === uid.value)
const drawnCardId = computed(() => (awaitingMyDrawDecision.value ? myHand.value[myHand.value.length - 1]?.id : null))
const startingColorChoiceIsMine = computed(() => !isNoMercy.value && game.value.pendingColorChoice === uid.value)
// No Mercy-only: Wild Color Roulette's color pick, and the "you must play
// the card you just drew" lock (no keep-and-pass in this mode).
const myRouletteChoice = computed(() => isNoMercy.value && game.value?.pendingRoulette === uid.value)
const myDrawnChoice = computed(() =>
  isNoMercy.value && game.value?.pendingDrawnChoice?.uid === uid.value ? game.value.pendingDrawnChoice : null,
)
const pendingDraw = computed(() => game.value.pendingDraw)
const pendingDrawAmount = computed(() => {
  const pd = pendingDraw.value
  if (!pd) return 0
  return isNoMercy.value ? pd.total : pd.count
})
const mustRespondToStack = computed(() => !!pendingDraw.value && actionable.value === uid.value)

function isCardPlayable(card) {
  const g = game.value
  if (g.status !== 'playing') return false
  if (pendingSwapCard.value || pendingWildCard.value) return false
  if (isNoMercy.value) {
    if (g.pendingRoulette) return false
    if (!myTurn.value || turnPauseActive.value) return false
    if (myDrawnChoice.value) return card.id === myDrawnChoice.value.cardId
    return activeEngine.value.isPlayableNow(card, g)
  }
  if (g.pendingColorChoice) return false
  if (!myTurn.value || turnPauseActive.value) return false
  if (awaitingMyDrawDecision.value) return card.id === drawnCardId.value && activeEngine.value.isPlayableNow(card, g)
  return activeEngine.value.isPlayableNow(card, g)
}

// Your own hand fans out in a slight arc, center raised — like cards held
// in two hands — instead of a flat overlapping row. The arc widens as you
// draw more cards (using up to the full screen width) and packs denser once
// it would otherwise run off the edge of the screen. No Mercy hands can get
// huge (the Mercy limit has no cap), so density alone isn't enough once
// spacing gets tiny — hovering near a card then ripples it and ~4 neighbors
// apart (see RIPPLE_* below) so you can still pick out and click the one you
// want, without ever needing a scrollbar.
const HAND_MAX_SPACING = 81
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
function onResize() {
  viewportWidth.value = window.innerWidth
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

const handAvailableWidth = computed(() => Math.max(240, viewportWidth.value - 48))
const HAND_EDGE_PAD = 12

// No floor here on purpose — the whole fan always has to fit in
// handAvailableWidth with zero scrolling, however dense that makes it. The
// spacing is between CARD CENTERS, but each card is HAND_CARD_PX wide, so a
// card's edge sticks out half its width past its center — that overhang has
// to come out of the available width too, or the outermost cards still run
// off-screen even though their centers technically fit.
function handSpacing(total) {
  if (total <= 1) return HAND_MAX_SPACING
  const fit = (handAvailableWidth.value - HAND_CARD_PX - HAND_EDGE_PAD) / (total - 1)
  return Math.min(HAND_MAX_SPACING, Math.max(0, fit))
}
// Capped so the droop never outgrows the fan's fixed-height box (260px).
const HAND_Y_DROOP_CAP = 40

// ---- Hover ripple: which card the mouse is currently over parts it and its
// nearest neighbors apart (and lifts/enlarges them) so a densely packed hand
// stays fully clickable — this is what replaces scrolling. ----
const hoverCardIndex = ref(null)
const RIPPLE_RADIUS = 2.4 // ~5 cards feel it (the hovered one + 2 each side)
const RIPPLE_PUSH = 46 // px the nearest neighbors get shoved apart, at peak
const RIPPLE_LIFT = 20 // px risen up, at peak
const RIPPLE_SCALE = 0.14 // extra scale, at peak
function onCardHoverEnter(i) {
  hoverCardIndex.value = i
}
function onCardHoverLeave(i) {
  if (hoverCardIndex.value === i) hoverCardIndex.value = null
}

function handCardStyle(i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)', zIndex: i }
  const mid = (total - 1) / 2
  const offset = i - mid
  const spacing = handSpacing(total)
  const rotate = offset * Math.min(6, 46 / total)
  let x = offset * spacing
  let y = Math.min(HAND_Y_DROOP_CAP, offset * offset * Math.min(3.4, 22 / total))
  let scale = 1
  let z = i

  const hovered = hoverCardIndex.value
  if (hovered !== null) {
    const dist = i - hovered
    const absDist = Math.abs(dist)
    if (absDist <= RIPPLE_RADIUS) {
      // Eased falloff (1 at the hovered card, 0 at the edge of the ripple) —
      // squaring gives a snappier, more "parted" feel than a linear fade.
      const eased = (1 - absDist / RIPPLE_RADIUS) ** 2
      x += Math.sign(dist) * eased * RIPPLE_PUSH
      y -= eased * RIPPLE_LIFT
      scale = 1 + eased * RIPPLE_SCALE
      z = 200 + Math.round(eased * 50)
    }
  }

  return {
    transform: `translateX(calc(-50% + ${x}px)) translateY(${y}px) rotate(${rotate}deg) scale(${scale})`,
    zIndex: z,
  }
}
// Natural width of the fan at its (always screen-safe) dense spacing —
// mirrors the same card-overhang + edge-pad accounting as handSpacing, so
// this never exceeds handAvailableWidth.
const handFanWidth = computed(() => {
  const n = myHand.value.length
  return Math.max(n - 1, 0) * handSpacing(n) + HAND_CARD_PX + HAND_EDGE_PAD
})

const noPlayableCards = computed(() => {
  const g = game.value
  if (isNoMercy.value) {
    if (!myTurn.value || g.pendingDrawnChoice || g.pendingRoulette) return false
    return myHand.value.every((c) => !activeEngine.value.isPlayableNow(c, g))
  }
  if (!myTurn.value || awaitingMyDrawDecision.value || g.pendingColorChoice) return false
  return myHand.value.every((c) => !activeEngine.value.isPlayableNow(c, g))
})

const drawPileLabel = computed(() => {
  if (mustRespondToStack.value) return `Draw ${pendingDrawAmount.value}!`
  if (noPlayableCards.value) return 'Draw!'
  return `${game.value.drawPile.length} left`
})

const turnBannerText = computed(() => {
  const g = game.value
  const nameOf = (id) => g.players.find((p) => p.uid === id)?.name ?? 'Player'
  if (isNoMercy.value) {
    if (pendingSwapCard.value) return 'Click a player to swap hands with!'
    if (g.pendingRoulette) {
      return g.pendingRoulette === uid.value ? 'Choose a color for Roulette!' : `${nameOf(g.pendingRoulette)} is spinning Color Roulette…`
    }
    if (g.pendingDrawnChoice) {
      return g.pendingDrawnChoice.uid === uid.value ? 'Play the card you drew!' : `${nameOf(g.pendingDrawnChoice.uid)} must play their drawn card…`
    }
    if (g.pendingDraw) {
      const target = g.playerOrder[g.currentIndex]
      return target === uid.value
        ? `Stack a ${g.pendingDraw.lastValue}+ or draw ${g.pendingDraw.total}!`
        : `${nameOf(target)} must respond to the +${g.pendingDraw.total} stack!`
    }
    const cur = g.playerOrder[g.currentIndex]
    return cur === uid.value ? 'Your turn' : `${nameOf(cur)}'s turn`
  }
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
  const g = game.value
  const p = g.players.find((pl) => pl.uid === id)
  return {
    uid: id,
    name: p?.name ?? 'Player',
    cards: g.hands[id] || [],
    score: g.scores[id] ?? 0,
    isTurn: actionable.value === id,
    vulnerable: (g.hands[id]?.length ?? 0) === 1 && !g.unoCalled[id],
    waitingOn: !!pendingDraw.value && actionable.value === id,
    eliminated: !!g.eliminated?.[id],
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
  if (isNoMercy.value) {
    // No Mercy's wild cards (Reverse Draw 4 / Draw 6 / Draw 10 / Color
    // Roulette) have no color-choice step at all — only a 7 needs extra
    // input, and that's chosen by clicking a seat at the table, not a modal.
    if (card.type === 'number' && card.value === 7) {
      pendingSwapCard.value = card
      return
    }
    submitPlay(card.id, null)
    return
  }
  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCard.value = card
    return
  }
  submitPlay(card.id, null)
}

const pendingWildCard = ref(null)
const pendingSwapCard = ref(null)
const swapCandidateUids = computed(() => {
  const g = game.value
  if (!g || !pendingSwapCard.value) return new Set()
  return new Set(opponents.value.filter((p) => !g.eliminated?.[p.uid]).map((p) => p.uid))
})

function onSeatClick(p) {
  if (!pendingSwapCard.value || !swapCandidateUids.value.has(p.uid)) return
  onChooseSwapTarget(p.uid)
}

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
  if (myRouletteChoice.value) {
    try {
      await roomStore.chooseRouletteColor(uid.value, color)
    } catch (e) {
      flashError(e)
    }
    return
  }
  const card = pendingWildCard.value
  pendingWildCard.value = null
  await submitPlay(card.id, color)
}

async function onChooseSwapTarget(targetUid) {
  unlockAudio()
  const card = pendingSwapCard.value
  pendingSwapCard.value = null
  await submitPlay(card.id, null, targetUid)
}

async function submitPlay(cardId, color, swapTargetUid) {
  try {
    await roomStore.playCard(uid.value, cardId, color, swapTargetUid)
  } catch (e) {
    flashError(e)
  }
}

async function onDrawPile() {
  unlockAudio()
  const g = game.value
  if (isNoMercy.value) {
    if (!myTurn.value || g.pendingDrawnChoice || g.pendingRoulette || turnPauseActive.value) return
  } else {
    if (!myTurn.value || awaitingMyDrawDecision.value || g.pendingColorChoice || turnPauseActive.value) return
  }
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

// Classic: strict rule, only callable in the exact moment you're about to
// play your second-to-last card — on your turn, holding exactly 2, with a
// legal play. No Mercy: looser official rule — call any time you're sitting
// on exactly 1 card, not gated on whose turn it is.
const showUnoButton = computed(() => {
  const g = game.value
  if (g.unoCalled[uid.value]) return false
  if (isNoMercy.value) return myHand.value.length === 1
  if (myHand.value.length !== 2) return false
  if (!myTurn.value) return false
  return myHand.value.some((c) => activeEngine.value.isPlayableNow(c, g))
})
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

// ---- Wild Color Roulette reveal arch: per the rules the revealed cards are
// public — everyone at the table watches them come up, not just the player
// hunting for their color. They land in a shared arch (visible to every
// viewer, not just the affected player) before being swept into that
// player's hand, instead of just silently appearing there. ----
const REVEAL_CARD_PX = 64 // matches PlayingCard size="md"
const REVEAL_STAGGER_MS = 260 // one-card-at-a-time reveal, like actually flipping them off the draw pile
const ROULETTE_HOLD_MS = 1200 // pause after the LAST card lands so everyone can read the full arch
const rouletteReveal = ref(null) // { cards, total, targetUid, color } while the arch is on screen
const rouletteArchEl = ref(null)
let rouletteRevealTimers = []

function clearRouletteRevealTimers() {
  rouletteRevealTimers.forEach(clearTimeout)
  rouletteRevealTimers = []
}

// Card positions are keyed off the FINAL count from the start, so earlier
// cards don't shift around as later ones fill in beside them.
function revealCardStyle(i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)', zIndex: i }
  const mid = (total - 1) / 2
  const offset = i - mid
  const spacing = Math.min(40, 300 / (total - 1))
  const rotate = offset * Math.min(5, 30 / total)
  const x = offset * spacing
  return { transform: `translateX(calc(-50% + ${x}px)) rotate(${rotate}deg)`, zIndex: i }
}

function triggerRouletteReveal(la) {
  clearRouletteRevealTimers()
  const cards = la.revealedCards
  rouletteReveal.value = { cards: [], total: cards.length, targetUid: la.by, color: la.color }

  // Reveal one card at a time (each gets its own flip-in as it's appended),
  // same pacing as physically turning cards off the draw pile one by one.
  cards.forEach((card, i) => {
    rouletteRevealTimers.push(
      setTimeout(() => {
        if (!rouletteReveal.value) return // superseded by a newer reveal
        rouletteReveal.value = { ...rouletteReveal.value, cards: [...rouletteReveal.value.cards, card] }
      }, i * REVEAL_STAGGER_MS),
    )
  })

  const fillDuration = cards.length * REVEAL_STAGGER_MS
  rouletteRevealTimers.push(
    setTimeout(() => {
      if (rouletteArchEl.value) {
        spawnFlyBatch({ el: rouletteArchEl.value, size: REVEAL_CARD_PX, alignLeft: false }, endpointFor(la.by), cards, 70)
      }
      const clearDelay = cards.length * 70 + 450
      rouletteRevealTimers.push(
        setTimeout(() => {
          rouletteReveal.value = null
        }, clearDelay),
      )
    }, fillDuration + ROULETTE_HOLD_MS),
  )
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
let wasStackPenaltyDraw = false
let lastSeenColor = game.value?.currentColor ?? null

const PLAY_TYPES = new Set([
  'play',
  'skip',
  'reverse',
  'stack-draw2',
  'stack-wild4',
  'wild',
  // No Mercy lastAction types that also put the played card on the discard pile.
  'discardAll',
  'skipEveryone',
  'stack',
  'swap7',
  'pass0',
  'roulette-pending',
])
const SFX_GAP_MS = 250

// Plays queued sfx one at a time: each one is awaited until it actually
// finishes (not a guessed duration) before the fixed gap, then the next
// starts. A single-item queue just fires immediately with no gap at all.
async function playSequenced(queue) {
  for (let i = 0; i < queue.length; i += 1) {
    await queue[i]()
    if (i < queue.length - 1) await new Promise((resolve) => setTimeout(resolve, SFX_GAP_MS))
  }
}

watch(
  () => game.value?.updatedAt,
  () => {
    const g = game.value
    if (!g || g.updatedAt === lastSeenUpdate) return
    lastSeenUpdate = g.updatedAt

    const la = g.lastAction
    const isStackPenaltyDraw = la?.type === 'forced-draw' || la?.type === 'forced-draw-partial'
    const isWild4Play = la?.card?.type === 'wild4' && PLAY_TYPES.has(la.type)

    // Several of these can be true for the same event (e.g. playing a Wild
    // +4 changes the color AND is a black card). Queue them instead of
    // firing all at once so they play one after another, not layered.
    const queue = []
    const enqueue = (fn) => queue.push(fn)

    if (g.lastDraw) {
      // A forced +2/+4 draw plays its cards one at a time (each its own fly
      // animation), but the sound should announce the penalty once, not
      // once per card — only fire on the first card of the sequence.
      if (isStackPenaltyDraw) {
        if (!wasStackPenaltyDraw) enqueue(() => sfx.drawStack())
      } else {
        enqueue(() => sfx.cardDraw(g.lastDraw.cardIds.length))
      }
    }
    wasStackPenaltyDraw = isStackPenaltyDraw

    switch (la?.type) {
      case 'play':
      case 'discardAll':
      case 'pass0':
      case 'swap7':
        enqueue(() => sfx.cardPlay())
        break
      case 'skip':
      case 'starter-skip':
      case 'skipEveryone':
        enqueue(() => sfx.skip())
        break
      case 'reverse':
      case 'starter-reverse':
        enqueue(() => sfx.reverse())
        break
      case 'stack-draw2':
      case 'stack':
        enqueue(() => sfx.stack())
        break
      case 'stack-wild4':
        // Wild +4 gets its own dedicated cue below instead of the generic
        // stacking blip — avoids two "something got drawn/stacked"-sounding
        // effects firing for the same card.
        break
      case 'wild':
      case 'roulette-pending':
        enqueue(() => sfx.wild())
        break
      case 'roulette-resolved':
        enqueue(() => sfx.drawStack())
        break
      case 'uno-call':
        enqueue(() => sfx.unoCall())
        break
      case 'uno-caught':
        enqueue(() => sfx.caught())
        break
      case 'pass':
      case 'color-chosen':
        enqueue(() => sfx.click())
        break
      case 'round-over':
        if (g.status === 'game-over') enqueue(() => sfx.gameWin())
        else enqueue(() => sfx.roundWin())
        break
      default:
        break
    }

    if (isWild4Play) enqueue(() => sfx.blackCard())

    if (g.currentColor && g.currentColor !== lastSeenColor) {
      enqueue(() => sfx.colorChange(g.currentColor))
    }
    lastSeenColor = g.currentColor

    playSequenced(queue)

    if (la?.card && PLAY_TYPES.has(la.type) && discardPileEl.value) {
      spawnFly(endpointFor(la.by), { el: discardPileEl.value, size: PILE_CARD_PX, alignLeft: false }, la.card)
    }
    // Discard All dumps every matching-color card from the hand at once —
    // animate every one of them flying out, not just the card that was played.
    if (la?.type === 'discardAll' && la.dumpedCards?.length && discardPileEl.value) {
      spawnFlyBatch(endpointFor(la.by), { el: discardPileEl.value, size: PILE_CARD_PX, alignLeft: false }, la.dumpedCards)
    }
    // Roulette's reveal is handled separately below (public arch first,
    // hand second) instead of the generic straight-to-hand fly every other
    // forced draw uses.
    if (g.lastDraw && drawPileEl.value && la?.type !== 'roulette-resolved') {
      const from = { el: drawPileEl.value, size: PILE_CARD_PX, alignLeft: false }
      spawnFlyBatch(from, endpointFor(g.lastDraw.by), g.lastDraw.cardIds.map(() => null))
    }
    if (la?.type === 'roulette-resolved' && la.revealedCards?.length) {
      triggerRouletteReveal(la)
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

// ---- Turn pause: whenever the turn actually hands off to someone else
// (not just a continuation, e.g. mid multi-card forced draw), everyone gets
// a fixed 3s beat to see what just happened before the new player can act.
// Shared/synchronized off game state, not a per-player thing. ----
const TURN_PAUSE_MS = 1000
const turnPauseActive = ref(false)
const pauseSecondsLeft = ref(null)
let turnPauseTimeout = null
let turnPauseInterval = null

function clearTurnPause() {
  clearTimeout(turnPauseTimeout)
  clearInterval(turnPauseInterval)
  turnPauseTimeout = null
  turnPauseInterval = null
}

watch(actionable, (newId, oldId) => {
  if (newId && oldId && newId !== oldId) {
    clearTurnPause()
    turnPauseActive.value = true
    pauseSecondsLeft.value = Math.ceil(TURN_PAUSE_MS / 1000)
    turnPauseInterval = setInterval(() => {
      if (pauseSecondsLeft.value !== null) pauseSecondsLeft.value -= 1
    }, 1000)
    turnPauseTimeout = setTimeout(() => {
      turnPauseActive.value = false
      pauseSecondsLeft.value = null
      clearTurnPause()
    }, TURN_PAUSE_MS)
  }
})

onBeforeUnmount(clearTurnPause)

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
  if (g.mode === 'no-mercy') {
    if (g.pendingRoulette === actUid) {
      return { kind: 'roulette', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
    }
    if (g.pendingDrawnChoice?.uid === actUid) {
      const card = g.hands[actUid].find((c) => c.id === g.pendingDrawnChoice.cardId)
      return { kind: 'play', card }
    }
    const hand = g.hands[actUid] || []
    const legal = hand.filter((c) => activeEngine.value.isPlayableNow(c, g))
    if (legal.length === 0) return { kind: 'draw' }
    return { kind: 'play', card: legal[Math.floor(Math.random() * legal.length)] }
  }
  if (g.pendingColorChoice === actUid) {
    return { kind: 'color', color: COLORS[Math.floor(Math.random() * COLORS.length)] }
  }
  if (g.awaitingDrawDecision === actUid) {
    const hand = g.hands[actUid]
    const drawn = hand[hand.length - 1]
    const options = [{ kind: 'pass' }]
    if (drawn && activeEngine.value.isPlayableNow(drawn, g)) options.push({ kind: 'play', card: drawn })
    return options[Math.floor(Math.random() * options.length)]
  }
  const hand = g.hands[actUid] || []
  const options = hand.filter((c) => activeEngine.value.isPlayableNow(c, g)).map((c) => ({ kind: 'play', card: c }))
  options.push({ kind: 'draw' })
  return options[Math.floor(Math.random() * options.length)]
}

async function autoDrawUntilResolved(actUid) {
  for (let guard = 0; guard < 60; guard += 1) {
    await roomStore.drawCard(actUid)
    const g = game.value
    if (!g) return
    if (g.mode === 'no-mercy') {
      if (g.pendingDrawnChoice?.uid === actUid) return
    } else if (g.awaitingDrawDecision === actUid) {
      return
    }
    if (activeEngine.value.actionableUid(g) !== actUid) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function performAutoAction(actUid) {
  const g = game.value
  if (!g) return
  const action = pickRandomAutoAction(g, actUid)
  try {
    if (action.kind === 'color') await roomStore.chooseStarterColor(actUid, action.color)
    else if (action.kind === 'roulette') await roomStore.chooseRouletteColor(actUid, action.color)
    else if (action.kind === 'pass') await roomStore.passTurn(actUid)
    else if (action.kind === 'draw') await autoDrawUntilResolved(actUid)
    else if (action.kind === 'play') {
      // No Mercy's wild cards need no color choice at all — only classic's do.
      const isWild = g.mode !== 'no-mercy' && (action.card.type === 'wild' || action.card.type === 'wild4')
      const isSwap7 = g.mode === 'no-mercy' && action.card.type === 'number' && action.card.value === 7
      const color = isWild ? COLORS[Math.floor(Math.random() * COLORS.length)] : null
      let swapTarget = null
      if (isSwap7) {
        const candidates = (activeEngine.value.activePlayers ? activeEngine.value.activePlayers(g) : g.playerOrder).filter(
          (u) => u !== actUid,
        )
        swapTarget = candidates[Math.floor(Math.random() * candidates.length)]
      }
      await roomStore.playCard(actUid, action.card.id, color, swapTarget)
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
    // Includes the 3s turn pause up front — nobody can act during it anyway.
    const totalMs = TURN_PAUSE_MS + AFK_SECONDS * 1000
    afkSecondsLeft.value = Math.ceil(totalMs / 1000)
    afkInterval = setInterval(() => {
      if (afkSecondsLeft.value !== null) afkSecondsLeft.value -= 1
    }, 1000)
    afkTimeout = setTimeout(() => {
      clearAfk()
      const cur = game.value
      if (cur && cur.updatedAt === startedAt && activeEngine.value.actionableUid(cur) === target) {
        performAutoAction(target)
      }
    }, totalMs)
  },
  { immediate: true },
)

// ---- Forced +2/+4 draws with no stack option happen automatically — no
// click needed — but each card still draws (and flies/animates) one at a
// time via the normal single-card drawCard flow. Only fires from the
// affected player's own client; if they're unreachable the AFK fallback
// above still resolves it after a few seconds. ----
let autoStackDrawFor = null
watch(
  () => [pendingDraw.value, actionable.value, game.value?.updatedAt, turnPauseActive.value],
  () => {
    const g = game.value
    if (!g || !pendingDraw.value || actionable.value !== uid.value || turnPauseActive.value) return
    const hand = g.hands[uid.value] || []
    const canStack = hand.some((c) => activeEngine.value.isPlayableNow(c, g))
    if (canStack) return
    if (autoStackDrawFor === uid.value) return
    autoStackDrawFor = uid.value
    autoDrawUntilResolved(uid.value)
      .catch(() => {
        // Race with another client/action — safe to ignore, state will settle.
      })
      .finally(() => {
        if (autoStackDrawFor === uid.value) autoStackDrawFor = null
      })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearAfk()
  clearTimeout(toastTimer)
  clearTimeout(blockedFlashTimer)
  clearRouletteRevealTimers()
})
</script>

<template>
  <!-- Screen-edge glow: a clear, ambient "it's your turn" cue beyond just the table/hand -->
  <div
    v-if="myTurn"
    class="pointer-events-none fixed inset-0 z-20 animate-edge-fade"
    style="box-shadow: inset 0 0 40px 8px rgba(250, 204, 21, 0.45), inset 0 0 120px 30px rgba(250, 204, 21, 0.2)"
    aria-hidden="true"
  ></div>

  <div class="mx-auto flex min-h-screen max-w-5xl flex-col px-3 py-4">
    <div class="mb-2 flex items-center justify-between text-xs text-slate-500">
      <span>
        Room <span class="font-semibold text-slate-300">{{ room.code }}</span>
        <span v-if="isNoMercy" class="ml-2 rounded-full bg-uno-red/20 px-2 py-0.5 text-[10px] font-bold text-uno-red">NO MERCY</span>
      </span>
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
        class="absolute -translate-x-1/2 -translate-y-1/2 transition-transform"
        :class="swapCandidateUids.has(p.uid) ? 'cursor-pointer hover:scale-110' : ''"
        :style="p.style"
        :ref="(el) => setSeatRef(p.uid, el)"
        @click="onSeatClick(p)"
      >
        <div
          v-if="swapCandidateUids.has(p.uid)"
          class="pointer-events-none absolute -inset-4 -z-10 animate-pulse rounded-full ring-4 ring-uno-yellow"
          aria-hidden="true"
        ></div>
        <PlayerBadge
          :name="p.name"
          :cards="p.cards"
          :is-turn="p.isTurn"
          :score="p.score"
          :vulnerable="p.vulnerable"
          :can-catch="p.vulnerable"
          :waiting-on="p.waitingOn"
          :eliminated="p.eliminated"
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
          <span v-if="turnPauseActive" class="ml-1 opacity-80"> ({{ pauseSecondsLeft }}s)</span>
          <span v-else-if="afkSecondsLeft !== null && afkSecondsLeft <= 5" class="ml-1 opacity-80">
            (auto in {{ afkSecondsLeft }}s)
          </span>
        </p>

        <!--
          Wild Color Roulette reveal arch — per the rules the revealed cards
          are public, so everyone at the table sees them land here, in the
          open, before they get swept into the hunting player's hand.
        -->
        <div v-if="rouletteReveal" class="flex flex-col items-center gap-2 animate-pop">
          <span class="rounded-full bg-slate-950/90 px-3 py-1 text-xs font-semibold text-slate-200 shadow">
            Hunting for
            <span class="font-bold capitalize" :style="{ color: COLOR_HEX[rouletteReveal.color] }">{{ rouletteReveal.color }}</span>
            …
          </span>
          <div ref="rouletteArchEl" class="relative" :style="{ height: '96px', width: '100%' }">
            <div
              v-for="(card, i) in rouletteReveal.cards"
              :key="card.id"
              class="absolute left-1/2 top-0 origin-bottom animate-flip-in"
              :style="revealCardStyle(i, rouletteReveal.total)"
            >
              <PlayingCard :card="card" size="md" />
            </div>
          </div>
        </div>

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
          {{ myTurn && turnPauseActive ? 'Get ready…' : myTurn ? 'Your hand' : `Waiting for ${turnBannerText}` }} ({{ myHand.length }})
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
      <div
        class="pointer-events-auto relative"
        :style="{ width: `${handFanWidth}px`, height: '260px' }"
        ref="myHandEl"
        @mouseleave="hoverCardIndex = null"
      >
        <div
          v-for="(card, idx) in sortedHand"
          :key="card.id"
          class="absolute left-1/2 top-4 origin-bottom transition-transform duration-150"
          :style="handCardStyle(idx, sortedHand.length)"
          @mouseenter="onCardHoverEnter(idx)"
          @mouseleave="onCardHoverLeave(idx)"
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

    <ColorPickerModal :show="!!pendingWildCard || startingColorChoiceIsMine || myRouletteChoice" @choose="onChooseColor" />

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
