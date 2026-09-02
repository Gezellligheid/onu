import { buildDeck, handPoints } from './deck.js'
import { shuffle, clone } from '../uno/shared.js'
import {
  COLORS,
  STARTING_HAND_SIZE,
  DEFAULT_MERCY_LIMIT,
  KNOCKOUT_BONUS,
  NO_UNO_CALL_PENALTY,
  DRAW_VALUE,
  DEFAULT_TARGET_SCORE,
  WILD_COLOR_CHOICE_TYPES,
} from './constants.js'

export function topCard(state) {
  return state.discardPile[state.discardPile.length - 1] ?? null
}

function isDrawCard(card) {
  return DRAW_VALUE[card.type] !== undefined
}

/** Base color/number/symbol matching — the same idea as classic UNO. */
export function isPlayable(card, top, currentColor) {
  if (!top) return true
  if (card.color === 'black') return true
  if (card.color === currentColor) return true
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true
  if (card.type !== 'number' && card.type === top.type) return true
  return false
}

/**
 * While a Draw stack is pending, only a Draw-type card whose own value is
 * >= the value of the card that set the current threshold may be played —
 * color/number/symbol matching is suspended, same spirit as classic's
 * stacking but value-tiered instead of type-matched (a +6 can answer a +4,
 * a +2 cannot). While a Color Roulette pick is pending, nothing can be
 * played until it resolves.
 */
export function isPlayableNow(card, state) {
  if (state.pendingRoulette) return false
  if (state.pendingDraw) return isDrawCard(card) && DRAW_VALUE[card.type] >= state.pendingDraw.lastValue
  return isPlayable(card, topCard(state), state.currentColor)
}

function activePlayers(state) {
  return state.playerOrder.filter((uid) => !state.eliminated[uid])
}

function stepIndex(state, steps) {
  const n = state.playerOrder.length
  let idx = state.currentIndex
  let remaining = steps
  let guard = 0
  while (remaining > 0 && guard < n * 20) {
    idx = (idx + state.direction + n) % n
    guard += 1
    if (!state.eliminated[state.playerOrder[idx]]) remaining -= 1
  }
  state.currentIndex = idx
}

function currentPlayerId(state) {
  return state.playerOrder[state.currentIndex]
}

function nameFor(state, uid) {
  return state.players.find((p) => p.uid === uid)?.name ?? 'Player'
}

function reshuffleFromDiscard(state) {
  const top = state.discardPile[state.discardPile.length - 1]
  const rest = state.discardPile.slice(0, -1)
  // Mercy-eliminated hands re-enter circulation the next time we need to reshuffle.
  const pool = rest.concat(state.setAsideCards)
  state.setAsideCards = []
  state.drawPile = shuffle(pool)
  state.discardPile = top ? [top] : []
}

function drawOne(state) {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length > 1 || state.setAsideCards.length > 0) {
      reshuffleFromDiscard(state)
    } else {
      state.drawPile = shuffle(buildDeck())
    }
  }
  return state.drawPile.pop()
}

export function createRound(
  players,
  { targetScore = DEFAULT_TARGET_SCORE, mercyLimit = DEFAULT_MERCY_LIMIT, scores = {}, roundNumber = 1 } = {},
) {
  const playerOrder = players.map((p) => p.uid)
  const hands = {}
  let deck = shuffle(buildDeck())

  for (const uid of playerOrder) hands[uid] = []
  for (let i = 0; i < STARTING_HAND_SIZE; i += 1) {
    for (const uid of playerOrder) hands[uid].push(deck.pop())
  }

  // Any Action or Wild card as the starter gets reshuffled back in — the
  // discard pile only ever starts on a plain number card.
  let starter = null
  while (true) {
    starter = deck.pop()
    if (starter.type === 'number') break
    deck = shuffle([starter, ...deck])
  }

  const nextScores = {}
  for (const uid of playerOrder) nextScores[uid] = scores[uid] ?? 0

  return {
    mode: 'no-mercy',
    status: 'playing',
    players,
    playerOrder,
    hands,
    drawPile: deck,
    discardPile: [starter],
    currentColor: starter.color,
    currentIndex: roundNumber > 1 ? (roundNumber - 1) % playerOrder.length : 0,
    direction: 1,
    pendingDraw: null,
    pendingRoulette: null,
    pendingDrawnChoice: null,
    eliminated: Object.fromEntries(playerOrder.map((uid) => [uid, false])),
    setAsideCards: [],
    knockouts: 0,
    unoCalled: Object.fromEntries(playerOrder.map((uid) => [uid, false])),
    scores: nextScores,
    targetScore,
    mercyLimit,
    roundNumber,
    lastAction: { type: 'round-start', message: 'New round dealt.' },
    lastDraw: null,
    roundWinner: null,
    roundPoints: 0,
    gameWinner: null,
    updatedAt: Date.now(),
  }
}

function describeCard(card) {
  if (card.type === 'number') return `${card.color} ${card.value}`
  if (card.color === 'black') return card.label
  return `${card.color} ${card.label}`
}

function finishRound(state, winnerId) {
  let roundPoints = 0
  for (const uid of state.playerOrder) {
    if (uid === winnerId || state.eliminated[uid]) continue
    roundPoints += handPoints(state.hands[uid] || [])
  }
  roundPoints += state.knockouts * KNOCKOUT_BONUS
  state.scores[winnerId] = (state.scores[winnerId] ?? 0) + roundPoints
  state.roundWinner = winnerId
  state.roundPoints = roundPoints
  state.status = 'round-over'
  state.lastAction = {
    type: 'round-over',
    by: winnerId,
    message: `${nameFor(state, winnerId)} wins the round and scores ${roundPoints}!`,
  }
  if (state.scores[winnerId] >= state.targetScore) {
    state.status = 'game-over'
    state.gameWinner = winnerId
  }
}

/**
 * Knocks a player out (Mercy rule), and ends the round if they were the
 * last one standing. A player can be eliminated while it's still their own
 * turn (mid partial forced-draw, or dealt a huge hand by a 7-swap) — in
 * that case the now-stale draw obligation is dropped and the turn hands
 * off to the next active seat, same as any other turn advance.
 */
function eliminate(state, uid) {
  if (state.eliminated[uid]) return
  const wasCurrent = state.status === 'playing' && currentPlayerId(state) === uid

  state.eliminated[uid] = true
  state.knockouts += 1
  state.setAsideCards.push(...state.hands[uid])
  state.hands[uid] = []
  delete state.unoCalled[uid]

  const remaining = activePlayers(state)
  if (remaining.length === 1) {
    finishRound(state, remaining[0])
    return
  }
  if (wasCurrent) {
    state.pendingDraw = null
    stepIndex(state, 1)
  }
}

/**
 * Call after any action that could change a hand's size: resets the UNO
 * call once you're no longer sitting on exactly one card, and checks for a
 * win (0 cards) or a Mercy knockout (state.mercyLimit+).
 */
function checkHandOutcome(state, uid) {
  if (state.status !== 'playing') return
  const hand = state.hands[uid]
  if (!hand) return
  if (hand.length !== 1) state.unoCalled[uid] = false
  if (hand.length === 0) {
    finishRound(state, uid)
  } else if (hand.length >= state.mercyLimit) {
    eliminate(state, uid)
  }
}

/** "0's Pass": every active player's whole hand moves to the next seat in the current direction. */
function rotateHands(state) {
  const order = activePlayers(state)
  if (order.length < 2) return
  const snapshot = order.map((uid) => state.hands[uid])
  const n = order.length
  for (let i = 0; i < n; i += 1) {
    const fromIdx = ((i - state.direction) % n + n) % n
    state.hands[order[i]] = snapshot[fromIdx]
  }
}

/**
 * Applies a just-played card's effect (turn advance, stacking, swap,
 * pass-around, elimination checks, ...). Shared by playCard and by
 * drawCard's "you must play what you just drew" auto-resolution.
 */
function applyCardEffect(state, uid, card, { swapTargetUid } = {}) {
  const hand = state.hands[uid]

  if (hand.length === 0) {
    finishRound(state, uid)
    return
  }
  if (hand.length === 1) state.unoCalled[uid] = false

  if (card.type === 'number' && card.value === 7) {
    const target = swapTargetUid
    const tmp = state.hands[uid]
    state.hands[uid] = state.hands[target]
    state.hands[target] = tmp
    state.lastAction = {
      type: 'swap7',
      by: uid,
      target,
      card,
      message: `${nameFor(state, uid)} swaps hands with ${nameFor(state, target)}!`,
    }
    stepIndex(state, 1)
    checkHandOutcome(state, uid)
    checkHandOutcome(state, target)
    return
  }
  if (card.type === 'number' && card.value === 0) {
    rotateHands(state)
    state.lastAction = { type: 'pass0', by: uid, card, message: `${nameFor(state, uid)} plays 0 — hands pass around!` }
    stepIndex(state, 1)
    for (const pid of activePlayers(state)) checkHandOutcome(state, pid)
    return
  }
  if (card.type === 'number') {
    state.lastAction = { type: 'play', by: uid, card, message: `${nameFor(state, uid)} played ${describeCard(card)}.` }
    stepIndex(state, 1)
    checkHandOutcome(state, uid)
    return
  }
  if (card.type === 'skip') {
    stepIndex(state, 1)
    const blocked = currentPlayerId(state)
    stepIndex(state, 1)
    state.lastAction = { type: 'skip', by: uid, target: blocked, card, message: `${nameFor(state, blocked)} is blocked!` }
    checkHandOutcome(state, uid)
    return
  }
  if (card.type === 'reverse') {
    state.direction *= -1
    stepIndex(state, activePlayers(state).length === 2 ? 2 : 1)
    state.lastAction = { type: 'reverse', by: uid, card, message: `${nameFor(state, uid)} played Reverse.` }
    checkHandOutcome(state, uid)
    return
  }
  if (card.type === 'discardAll') {
    const color = card.color
    const keep = []
    const dumped = []
    for (const c of hand) (c.color === color ? dumped : keep).push(c)
    state.hands[uid] = keep
    // Per the official rule, the extra cards go UNDER the Discard All card,
    // which stays on top — playCard already pushed it, so pop it off, pile
    // the dumped cards underneath, then put it back on top.
    const onTop = state.discardPile.pop()
    state.discardPile.push(...dumped, onTop)
    state.lastAction = {
      type: 'discardAll',
      by: uid,
      card,
      dumpedCards: dumped,
      message: `${nameFor(state, uid)} dumps ${dumped.length} more ${color} card(s)!`,
    }
    stepIndex(state, 1)
    checkHandOutcome(state, uid)
    return
  }
  if (card.type === 'skipEveryone') {
    state.lastAction = {
      type: 'skipEveryone',
      by: uid,
      card,
      message: `${nameFor(state, uid)} skips everyone and goes again!`,
    }
    checkHandOutcome(state, uid)
    return
  }
  if (card.type === 'wildColorRoulette') {
    stepIndex(state, 1)
    state.pendingRoulette = currentPlayerId(state)
    state.lastAction = {
      type: 'roulette-pending',
      by: uid,
      target: state.pendingRoulette,
      card,
      message: `${nameFor(state, state.pendingRoulette)} must pick a color for Color Roulette!`,
    }
    checkHandOutcome(state, uid)
    return
  }

  // Draw-value cards: draw2, draw4, wildReverseDraw4, wildDraw6, wildDraw10
  const value = DRAW_VALUE[card.type]
  const stacked = !!state.pendingDraw
  if (card.type === 'wildReverseDraw4') state.direction *= -1
  state.pendingDraw = { lastValue: value, total: (state.pendingDraw?.total ?? 0) + value }
  stepIndex(state, card.type === 'wildReverseDraw4' && activePlayers(state).length === 2 ? 2 : 1)
  state.lastAction = {
    type: 'stack',
    by: uid,
    card,
    message: stacked
      ? `${nameFor(state, uid)} stacks +${value} (total ${state.pendingDraw.total})!`
      : `${nameFor(state, uid)} played +${value}.`,
  }
  checkHandOutcome(state, uid)
}

export function playCard(state, uid, cardId, chosenColor, swapTargetUid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.eliminated[uid]) throw new Error('You have been knocked out of this round.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.pendingRoulette) throw new Error('Waiting on a Color Roulette pick.')

  const hand = next.hands[uid]
  const cardIdx = hand.findIndex((c) => c.id === cardId)
  if (cardIdx === -1) throw new Error('Card not in hand.')
  const card = hand[cardIdx]

  if (next.pendingDrawnChoice) {
    if (next.pendingDrawnChoice.uid !== uid || next.pendingDrawnChoice.cardId !== cardId) {
      throw new Error('You must play the card you just drew.')
    }
  } else if (!isPlayableNow(card, next)) {
    if (next.pendingDraw) {
      throw new Error(`You must stack a card worth ${next.pendingDraw.lastValue}+ or draw ${next.pendingDraw.total}.`)
    }
    throw new Error('Card does not match color, number, or type.')
  }

  if (card.type === 'number' && card.value === 7) {
    if (!swapTargetUid || swapTargetUid === uid) throw new Error('Choose another player to swap hands with.')
    if (!next.hands[swapTargetUid] || next.eliminated[swapTargetUid]) throw new Error('Invalid swap target.')
  }
  if (WILD_COLOR_CHOICE_TYPES.includes(card.type) && !COLORS.includes(chosenColor)) {
    throw new Error('Choose a color.')
  }

  next.pendingDrawnChoice = null
  hand.splice(cardIdx, 1)
  next.discardPile.push(card)
  next.lastDraw = null
  // House rule: Wild Reverse Draw 4 / Draw 6 / Draw 10 let whoever plays
  // them choose the next color, same as classic's Wild/Wild+4 (the official
  // rules have no color-choice step here, but the app adds one). Wild Color
  // Roulette is the one black card that still leaves currentColor
  // unchanged — its "choose a color" is the NEXT player's hunt color, a
  // different mechanic entirely.
  if (card.color !== 'black') {
    next.currentColor = card.color
  } else if (WILD_COLOR_CHOICE_TYPES.includes(card.type)) {
    next.currentColor = chosenColor
  }

  applyCardEffect(next, uid, card, { swapTargetUid })

  next.updatedAt = Date.now()
  return next
}

/**
 * Draws exactly one card (matches the classic engine's click-per-draw
 * pacing). Three situations:
 *  - A pending Draw stack: this card counts against the total; once it's
 *    fully drawn the stack clears and the turn passes.
 *  - No legal card: drawing doesn't pass your turn — if this card isn't
 *    playable either you must draw again. Once you draw something
 *    playable there's no keep-and-pass choice: it gets played immediately,
 *    or (if it needs a color/swap target) you're forced to supply that and
 *    nothing else next.
 */
export function drawCard(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.eliminated[uid]) throw new Error('You have been knocked out of this round.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.pendingDrawnChoice) throw new Error('Resolve your drawn card first.')
  if (next.pendingRoulette) throw new Error('Waiting on a Color Roulette pick.')

  const card = drawOne(next)
  next.hands[uid].push(card)

  if (next.pendingDraw) {
    const remaining = next.pendingDraw.total - 1
    next.lastDraw = { id: Date.now(), by: uid, cardIds: [card.id], forced: true }
    if (remaining <= 0) {
      next.pendingDraw = null
      stepIndex(next, 1)
      next.lastAction = { type: 'forced-draw', by: uid, message: `${nameFor(next, uid)} finishes drawing and is skipped.` }
    } else {
      next.pendingDraw = { lastValue: next.pendingDraw.lastValue, total: remaining }
      next.lastAction = { type: 'forced-draw-partial', by: uid, message: `${nameFor(next, uid)} draws one (${remaining} more to go)...` }
    }
    checkHandOutcome(next, uid)
    next.updatedAt = Date.now()
    return next
  }

  next.lastDraw = { id: Date.now(), by: uid, cardIds: [card.id], forced: false }

  if (!isPlayableNow(card, next)) {
    next.lastAction = { type: 'draw-again', by: uid, message: `${nameFor(next, uid)} drew a card — no play, draw again.` }
    checkHandOutcome(next, uid)
    next.updatedAt = Date.now()
    return next
  }

  // A drawn 7 needs a swap target, and a drawn Wild Reverse Draw 4 / Draw 6
  // / Draw 10 needs a color choice (house rule — see WILD_COLOR_CHOICE_TYPES)
  // — everything else (including Wild Color Roulette) resolves immediately
  // below with no extra input.
  const isSwap7 = card.type === 'number' && card.value === 7
  const needsColorChoice = WILD_COLOR_CHOICE_TYPES.includes(card.type)
  if (isSwap7 || needsColorChoice) {
    next.pendingDrawnChoice = { uid, cardId: card.id }
    next.lastAction = {
      type: 'draw-needs-choice',
      by: uid,
      card,
      message: `${nameFor(next, uid)} drew ${describeCard(card)} — must ${isSwap7 ? 'choose who to swap with' : 'choose a color'}.`,
    }
    next.updatedAt = Date.now()
    return next
  }

  // No extra input needed — mandatory play resolves immediately.
  const hand = next.hands[uid]
  hand.splice(hand.length - 1, 1)
  next.discardPile.push(card)
  if (card.color !== 'black') next.currentColor = card.color
  applyCardEffect(next, uid, card, {})
  next.updatedAt = Date.now()
  return next
}

export function chooseRouletteColor(state, uid, color) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.pendingRoulette !== uid) throw new Error('Not your color choice to make.')
  if (!COLORS.includes(color)) throw new Error('Invalid color.')

  const revealed = []
  let guard = 0
  while (guard < 1000) {
    guard += 1
    const card = drawOne(next)
    revealed.push(card)
    if (card.color === color) break // wild cards do NOT count as a match
  }
  next.hands[uid].push(...revealed)
  next.pendingRoulette = null
  next.lastDraw = { id: Date.now(), by: uid, cardIds: revealed.map((c) => c.id), forced: true }
  stepIndex(next, 1)
  next.lastAction = {
    type: 'roulette-resolved',
    by: uid,
    color,
    revealedCards: revealed,
    message: `${nameFor(next, uid)} reveals ${revealed.length} card(s) hunting for ${color} and is skipped!`,
  }
  checkHandOutcome(next, uid)
  next.updatedAt = Date.now()
  return next
}

export function callUno(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  const hand = next.hands[uid]
  if (!hand) throw new Error('Unknown player.')
  if (next.eliminated[uid]) throw new Error('You have been knocked out of this round.')
  if (hand.length !== 1) throw new Error('You can only call UNO when you have exactly one card.')
  next.unoCalled[uid] = true
  next.lastAction = { type: 'uno-call', by: uid, message: `${nameFor(next, uid)} called UNO!` }
  next.updatedAt = Date.now()
  return next
}

export function catchUno(state, catcherId, targetId) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (targetId === catcherId) throw new Error('You cannot catch yourself.')
  const hand = next.hands[targetId]
  if (!hand || hand.length !== 1) throw new Error('That player is not sitting on one card.')
  if (next.unoCalled[targetId]) throw new Error('They already called UNO.')

  const drawn = []
  for (let i = 0; i < NO_UNO_CALL_PENALTY; i += 1) drawn.push(drawOne(next))
  hand.push(...drawn)
  next.unoCalled[targetId] = true
  next.lastDraw = { id: Date.now(), by: targetId, cardIds: drawn.map((c) => c.id), forced: true }
  next.lastAction = {
    type: 'uno-caught',
    by: catcherId,
    target: targetId,
    message: `${nameFor(next, catcherId)} caught ${nameFor(next, targetId)} without UNO! +2 cards.`,
  }
  checkHandOutcome(next, targetId)
  next.updatedAt = Date.now()
  return next
}

export function startNextRound(state) {
  if (state.status !== 'round-over') throw new Error('Current round has not finished.')
  return createRound(state.players, {
    targetScore: state.targetScore,
    mercyLimit: state.mercyLimit,
    scores: state.scores,
    roundNumber: state.roundNumber + 1,
  })
}

export function isMyTurn(state, uid) {
  return state.status === 'playing' && !state.pendingRoulette && currentPlayerId(state) === uid
}

/** Whoever the game is currently waiting on to take *some* action. */
export function actionableUid(state) {
  if (state.status !== 'playing') return null
  if (state.pendingRoulette) return state.pendingRoulette
  return currentPlayerId(state)
}

export { currentPlayerId, activePlayers }
