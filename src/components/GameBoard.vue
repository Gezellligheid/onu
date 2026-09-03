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
import { WILD_COLOR_CHOICE_TYPES } from '../lib/no-mercy/constants.js'

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
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 800)
function onResize() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// A phone rotated to landscape is wide but short (typically well under
// 500px tall) — plenty of width for "desktop-sized" cards but not enough
// height for the desktop layout's proportions. Detected separately from
// isMobileCardSize (which only looks at width) so landscape phones still
// get compact sizing despite their generous width.
const isLandscapeMobile = computed(() => viewportWidth.value > viewportHeight.value && viewportHeight.value < 520)
// Narrow + portrait: the one case gameplay doesn't work well in. Nudges the
// player to rotate rather than trying to cram the board into a tall sliver.
const isNarrowPortrait = computed(() => viewportHeight.value >= viewportWidth.value && viewportWidth.value < 820)

const handAvailableWidth = computed(() => Math.max(240, viewportWidth.value - 48))

// The hand box's fixed height only needs to fit the (mobile-shrunk) card
// height plus its droop — 260px was tuned for the desktop xl card.
const handBoxHeight = computed(() => (isMobileCardSize.value ? 200 : 260))
const HAND_EDGE_PAD = 12

// Landscape-mobile has so little vertical room that even compact cards are
// worth partially sinking below the viewport edge — only the top portion
// (numbers/symbols live in the corners) needs to stay visible to identify
// and tap a card; hovering/tapping still lifts it via the ripple effect.
const handOffscreenPx = computed(() => (isLandscapeMobile.value ? Math.round(handBoxHeight.value * 0.4) : 0))

// Once a hand grows past HAND_ARC_SIZE cards (No Mercy's Mercy limit has no
// cap, so this genuinely happens), it splits into multiple fans of up to
// HAND_ARC_SIZE cards each, stacked one under another — each arc dense-packs
// and ripples independently instead of one single fan getting absurdly thin.
const HAND_ARC_SIZE = 40
const HAND_ARC_GAP = -30 // negative = arcs overlap slightly, reading as one tighter stack instead of far-apart rows
const handArcs = computed(() => {
  const hand = sortedHand.value
  if (hand.length === 0) return [[]]
  const arcs = []
  for (let i = 0; i < hand.length; i += HAND_ARC_SIZE) arcs.push(hand.slice(i, i + HAND_ARC_SIZE))
  return arcs
})
const handTotalHeight = computed(
  () => handBoxHeight.value * handArcs.value.length + HAND_ARC_GAP * Math.max(handArcs.value.length - 1, 0),
)

// No floor here on purpose — the whole fan always has to fit in
// handAvailableWidth with zero scrolling, however dense that makes it. The
// spacing is between CARD CENTERS, but each card is HAND_CARD_PX wide, so a
// card's edge sticks out half its width past its center — that overhang has
// to come out of the available width too, or the outermost cards still run
// off-screen even though their centers technically fit.
function handSpacing(total) {
  if (total <= 1) return HAND_MAX_SPACING
  const fit = (handAvailableWidth.value - HAND_CARD_PX.value - HAND_EDGE_PAD) / (total - 1)
  return Math.min(HAND_MAX_SPACING, Math.max(0, fit))
}
// Capped so the droop never outgrows the fan's fixed-height box (260px).
const HAND_Y_DROOP_CAP = 40

// ---- Hover ripple: which card the mouse is currently over parts it and its
// nearest neighbors apart (and lifts/enlarges them) so a densely packed hand
// stays fully clickable — this is what replaces scrolling. Scoped per arc
// (arcIdx + card index) so hovering one arc never ripples a different one. ----
const hoverArc = ref(null)
const hoverCardIndex = ref(null)
const RIPPLE_RADIUS = 2.4 // ~5 cards feel it (the hovered one + 2 each side)
const RIPPLE_PUSH = 46 // px the nearest neighbors get shoved apart, at peak
const RIPPLE_LIFT = 20 // px risen up, at peak
const RIPPLE_SCALE = 0.14 // extra scale, at peak
function onCardHoverEnter(arcIdx, i) {
  hoverArc.value = arcIdx
  hoverCardIndex.value = i
}
function onCardHoverLeave(arcIdx, i) {
  if (hoverArc.value === arcIdx && hoverCardIndex.value === i) {
    hoverArc.value = null
    hoverCardIndex.value = null
  }
}
function clearHandHover() {
  hoverArc.value = null
  hoverCardIndex.value = null
}

function handCardStyle(arcIdx, i, total) {
  if (total <= 1) return { transform: 'translateX(-50%)', zIndex: i }
  const mid = (total - 1) / 2
  const offset = i - mid
  const spacing = handSpacing(total)
  const rotate = offset * Math.min(6, 46 / total)
  let x = offset * spacing
  let y = Math.min(HAND_Y_DROOP_CAP, offset * offset * Math.min(3.4, 22 / total))
  let scale = 1
  let z = i

  const hovered = hoverArc.value === arcIdx ? hoverCardIndex.value : null
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
// Natural width of one arc's fan at its (always screen-safe) dense spacing —
// mirrors the same card-overhang + edge-pad accounting as handSpacing, so
// this never exceeds handAvailableWidth. The overall hand container is sized
// to the widest arc (normally all of them, except perhaps a shorter last one).
function fanWidthFor(total) {
  return Math.max(total - 1, 0) * handSpacing(total) + HAND_CARD_PX.value + HAND_EDGE_PAD
}
const handFanWidth = computed(() => handArcs.value.reduce((max, arc) => Math.max(max, fanWidthFor(arc.length)), 0))

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
        ? `Stack ${g.pendingDraw.lastValue}+, block, redirect, or draw ${g.pendingDraw.total}!`
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
      ? `Stack, block with Skip, redirect with Reverse, or draw ${g.pendingDraw.count}!`
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

// On a small/short screen there isn't room to keep every opponent's seat
// visible and legible at once, especially with several players — so mobile
// layouts only show a window of up to 3, centered on whoever the game
// currently needs an action from, and re-centers as that changes. Desktop
// shows everyone since it has the room for it. While choosing a 7-swap
// target, the window is bypassed entirely — every candidate needs to be
// clickable, not just the 3 currently in view.
const isMobileLayout = computed(() => isMobileCardSize.value || isLandscapeMobile.value)
const hiddenOpponentCount = computed(() =>
  isMobileLayout.value && !pendingSwapCard.value ? Math.max(0, opponents.value.length - 3) : 0,
)

// A simple row, left-to-right in turn order — the direction indicator next
// to the piles (below) is what shows which way that currently flows, since
// Reverse flips the direction, not the seats.
const opponentSeats = computed(() => {
  const list = opponents.value
  if (!isMobileLayout.value || list.length <= 3 || pendingSwapCard.value) return list
  const n = list.length
  let centerIdx = list.findIndex((p) => p.uid === actionable.value)
  if (centerIdx === -1) centerIdx = 0
  return [list[(centerIdx - 1 + n) % n], list[centerIdx], list[(centerIdx + 1) % n]]
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
// Small badge-sized icon next to the piles — not a big background element.
const DIR_CX = 30
const DIR_CY = 20
const DIR_RX = 24
const DIR_RY = 15
const directionArcPath = ellipseArcPath(DIR_CX, DIR_CY, DIR_RX, DIR_RY, -35, 250)
const directionArrowPoints = arrowHeadPoints(DIR_CX, DIR_CY, DIR_RX, DIR_RY, 250, 6)

// House rule: Jump-In — a card matching the discard pile's top card EXACTLY
// (color AND number/symbol) can be played out of turn, any time. Only
// considered when the card isn't already a normal in-turn play.
function isJumpInEligible(card) {
  const g = game.value
  if (!g || g.status !== 'playing') return false
  if (myTurn.value || turnPauseActive.value) return false
  if (pendingSwapCard.value || pendingWildCard.value) return false
  return !!activeEngine.value.isJumpInMatch?.(card, g)
}

// "X" shortcut: jump in with the first eligible card in hand — no need to
// hunt for the (already cyan-glowing) card and click it precisely. Not
// Space — that's the browser's native "scroll down" key and fighting that
// felt like the page was jumping around even with preventDefault.
const jumpInHotkeyCard = computed(() => myHand.value.find((c) => isJumpInEligible(c)) ?? null)
function onJumpInHotkey(e) {
  if (e.code !== 'KeyX' || e.repeat) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
  const card = jumpInHotkeyCard.value
  if (!card) return
  e.preventDefault()
  onCardClick(card)
}
onMounted(() => window.addEventListener('keydown', onJumpInHotkey))
onBeforeUnmount(() => window.removeEventListener('keydown', onJumpInHotkey))

function onCardClick(card) {
  unlockAudio()
  const viaJumpIn = !isCardPlayable(card) && isJumpInEligible(card)
  if (!isCardPlayable(card) && !viaJumpIn) return
  if (isNoMercy.value) {
    // A 7 needs a swap target, chosen by clicking a seat at the table. Wild
    // Reverse Draw 4 / Draw 6 / Draw 10 need a color choice (house rule).
    // Wild Color Roulette needs neither — its "choose a color" belongs to
    // the next player, not whoever plays it.
    if (card.type === 'number' && card.value === 7) {
      pendingSwapCard.value = card
      pendingIsJumpIn.value = viaJumpIn
      return
    }
    if (WILD_COLOR_CHOICE_TYPES.includes(card.type)) {
      pendingWildCard.value = card
      pendingIsJumpIn.value = viaJumpIn
      return
    }
    submitPlay(card.id, null, undefined, viaJumpIn)
    return
  }
  if (card.type === 'wild' || card.type === 'wild4') {
    pendingWildCard.value = card
    pendingIsJumpIn.value = viaJumpIn
    return
  }
  submitPlay(card.id, null, undefined, viaJumpIn)
}

const pendingWildCard = ref(null)
const pendingSwapCard = ref(null)
const pendingIsJumpIn = ref(false)
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
  const viaJumpIn = pendingIsJumpIn.value
  pendingWildCard.value = null
  pendingIsJumpIn.value = false
  await submitPlay(card.id, color, undefined, viaJumpIn)
}

async function onChooseSwapTarget(targetUid) {
  unlockAudio()
  const card = pendingSwapCard.value
  const viaJumpIn = pendingIsJumpIn.value
  pendingSwapCard.value = null
  pendingIsJumpIn.value = false
  await submitPlay(card.id, null, targetUid, viaJumpIn)
}

async function submitPlay(cardId, color, swapTargetUid, viaJumpIn) {
  try {
    if (viaJumpIn) await roomStore.jumpIn(uid.value, cardId, color, swapTargetUid)
    else await roomStore.playCard(uid.value, cardId, color, swapTargetUid)
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
  // Jump-In: you may also call the instant before jumping in out of turn.
  if (myTurn.value) return myHand.value.some((c) => activeEngine.value.isPlayableNow(c, g))
  return myHand.value.some((c) => isJumpInEligible(c))
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
// PlayingCard's xl/lg sizes shrink below this same viewport width via a
// `sm:` Tailwind breakpoint (bypassed in landscape-mobile via its `compact`
// prop, driven by this same flag) — these mirror that in JS so
// fly-animation clones and fan-spacing math stay in sync with what's
// actually rendered.
const MOBILE_CARD_BREAKPOINT = 640
const isMobileCardSize = computed(() => viewportWidth.value < MOBILE_CARD_BREAKPOINT || isLandscapeMobile.value)
const HAND_CARD_PX = computed(() => (isMobileCardSize.value ? 96 : 134)) // matches PlayingCard size="xl"
const SEAT_CARD_PX = 40 // matches CardFan's size="sm" (unchanged across breakpoints)
const PILE_CARD_PX = computed(() => (isMobileCardSize.value ? 80 : 112)) // matches PlayingCard size="lg"

function endpointFor(playerUid) {
  if (playerUid === uid.value) return { el: myHandEl.value, size: HAND_CARD_PX.value, alignLeft: false }
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
      // Discard All's dumped cards land UNDER it (see the engine) — so its
      // own fly waits until after their batch lands, landing last/on top
      // to match. Every other play type flies immediately as before.
      const dumpedCount = la.type === 'discardAll' ? la.dumpedCards?.length ?? 0 : 0
      const cardFlyDelay = dumpedCount * 110
      setTimeout(
        () => spawnFly(endpointFor(la.by), { el: discardPileEl.value, size: PILE_CARD_PX.value, alignLeft: false }, la.card),
        cardFlyDelay,
      )
    }
    // Discard All dumps every matching-color card from the hand at once —
    // animate every one of them flying out, not just the card that was played.
    if (la?.type === 'discardAll' && la.dumpedCards?.length && discardPileEl.value) {
      spawnFlyBatch(endpointFor(la.by), { el: discardPileEl.value, size: PILE_CARD_PX.value, alignLeft: false }, la.dumpedCards)
    }
    // Roulette's reveal is handled separately below (public arch first,
    // hand second) instead of the generic straight-to-hand fly every other
    // forced draw uses.
    if (g.lastDraw && drawPileEl.value && la?.type !== 'roulette-resolved') {
      const from = { el: drawPileEl.value, size: PILE_CARD_PX.value, alignLeft: false }
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
      const isWild =
        g.mode === 'no-mercy'
          ? WILD_COLOR_CHOICE_TYPES.includes(action.card.type)
          : action.card.type === 'wild' || action.card.type === 'wild4'
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

  <!-- Rotate prompt: the board is designed to play in landscape on a phone —
  narrow portrait doesn't have the width for the play area + hand at once. -->
  <div v-if="isNarrowPortrait" class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center">
    <div class="animate-rotate-hint text-6xl">📱</div>
    <p class="font-display text-lg font-bold text-slate-100">Rotate your device</p>
    <p class="max-w-xs text-sm text-slate-400">UNO Online plays best in landscape — turn your phone sideways to fit everyone at once.</p>
  </div>

  <div v-else class="mx-auto flex h-screen max-w-5xl flex-col overflow-y-hidden px-3 py-4">
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

    <!-- Opponents: a plain row, no table underneath them. -->
    <div class="relative mb-2 flex items-start justify-center gap-4 sm:gap-8">
      <span
        v-if="hiddenOpponentCount > 0"
        class="absolute -right-1 -top-1 rounded-full bg-slate-950/70 px-2 py-0.5 text-[10px] text-slate-400 backdrop-blur"
      >
        +{{ hiddenOpponentCount }} more
      </span>
      <div
        v-for="p in opponentSeats"
        :key="p.uid"
        class="relative transition-transform"
        :class="swapCandidateUids.has(p.uid) ? 'cursor-pointer hover:scale-110' : ''"
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
    </div>

    <!-- Center: turn banner + piles, filling whatever space is left. -->
    <div ref="tableCenterEl" class="flex flex-1 flex-col items-center justify-center gap-3">
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

      <div class="flex items-center gap-3">
        <button type="button" class="flex flex-col items-center gap-1" ref="drawPileEl" @click="onDrawPile">
          <PlayingCard
            :card="null"
            size="lg"
            :compact="isMobileCardSize"
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

        <!-- Small direction indicator, mirrored when play reverses -->
        <svg
          viewBox="0 0 60 40"
          class="pointer-events-none h-6 w-9 shrink-0 transition-transform duration-500"
          :class="game.direction === -1 ? '[transform:scaleX(-1)]' : ''"
          aria-hidden="true"
        >
          <path :d="directionArcPath" fill="none" stroke="#facc15" stroke-width="4" stroke-linecap="round" opacity="0.85" />
          <polygon :points="directionArrowPoints" fill="#facc15" opacity="1" />
        </svg>

        <div class="flex flex-col items-center gap-1" ref="discardPileEl">
          <div class="relative rounded-xl" :style="{ boxShadow: `0 0 0 3px ${COLOR_HEX[game.currentColor]}` }">
            <PlayingCard
              :card="top"
              size="lg"
              :compact="isMobileCardSize"
              animate-in="flip"
              :tint-color="COLOR_HEX[game.currentColor]"
              :key="top?.id"
            />
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

    <p v-if="game.lastAction?.message" class="mb-2 text-center text-xs text-slate-500">
      {{ game.lastAction.message }}
    </p>

    <!-- UNO call button: fixed to the left-center edge — always reachable
    one-handed regardless of hand scroll/fan position. -->
    <button
      v-if="showUnoButton"
      type="button"
      class="pointer-events-auto fixed left-3 top-1/2 z-40 -translate-y-1/2 animate-pulse-glow rounded-full bg-uno-red px-6 py-3 text-lg font-extrabold text-white shadow-lg"
      @click="onCallUno"
    >
      UNO!
    </button>

    <!-- Spacer so page content isn't hidden behind the floating hand's
    VISIBLE portion — the part deliberately pushed offscreen (see
    handOffscreenPx) doesn't need protecting, or this squeezes the flex-1
    center content above it down to nothing on a short landscape screen. -->
    <div :style="{ height: `${Math.max(0, handTotalHeight - handOffscreenPx) + 46}px` }"></div>

    <!-- My hand: floats freely in front of everything, no boxed panel -->
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center pb-3" :class="shakeHand ? 'animate-shake' : ''">
      <p
        v-if="jumpInHotkeyCard"
        class="pointer-events-none mb-1 animate-pulse-glow rounded-full bg-cyan-400/20 px-3 py-1 text-xs font-bold text-cyan-300 shadow"
      >
        Press <kbd class="rounded border border-cyan-300/50 bg-cyan-950/60 px-1.5 py-0.5 font-mono">X</kbd> to jump in!
      </p>
      <div class="pointer-events-auto mb-1 flex items-center gap-3">
        <span class="rounded-full bg-slate-950/70 px-2 py-0.5 text-xs text-slate-400 backdrop-blur">
          {{ myTurn && turnPauseActive ? 'Get ready…' : myTurn ? 'Your hand' : `Waiting for ${turnBannerText}` }} ({{ myHand.length }})
        </span>
      </div>
      <!--
        A hand over HAND_ARC_SIZE cards (no cap on the Mercy limit means this
        genuinely happens) splits into multiple fans stacked one under
        another instead of one fan getting absurdly thin.
      -->
      <div
        class="pointer-events-auto flex flex-col items-center"
        :style="{ gap: `${HAND_ARC_GAP}px`, transform: `translateY(${handOffscreenPx}px)` }"
        ref="myHandEl"
        @mouseleave="clearHandHover"
      >
        <div
          v-for="(arc, arcIdx) in handArcs"
          :key="arcIdx"
          class="relative"
          :style="{ width: `${fanWidthFor(arc.length)}px`, height: `${handBoxHeight}px` }"
        >
          <div
            v-for="(card, idx) in arc"
            :key="card.id"
            class="absolute left-1/2 top-4 origin-bottom transition-transform duration-150"
            :style="handCardStyle(arcIdx, idx, arc.length)"
            @mouseenter="onCardHoverEnter(arcIdx, idx)"
            @mouseleave="onCardHoverLeave(arcIdx, idx)"
          >
            <PlayingCard
              :card="card"
              size="xl"
              :compact="isMobileCardSize"
              :playable="isCardPlayable(card)"
              :disabled="!isCardPlayable(card) && !isJumpInEligible(card)"
              :glow="isCardPlayable(card) && !pendingDraw"
              :urgent="isCardPlayable(card) && !!pendingDraw"
              :jump-in="!isCardPlayable(card) && isJumpInEligible(card)"
              animate-in="deal"
              :style="{ animationDelay: `${(arcIdx * HAND_ARC_SIZE + idx) * 35}ms` }"
              @click="onCardClick(card)"
            />
          </div>
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
