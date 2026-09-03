import { buildDeck, shuffle, handPoints } from './deck.js'
import {
  COLORS,
  STARTING_HAND_SIZE,
  DRAW_TWO_PENALTY,
  WILD_DRAW_FOUR_PENALTY,
  NO_UNO_CALL_PENALTY,
  DEFAULT_TARGET_SCORE,
} from './constants.js'

export function topCard(state) {
  return state.discardPile[state.discardPile.length - 1] ?? null
}

export function isPlayable(card, top, currentColor) {
  if (!top) return true
  if (card.color === 'black') return true
  if (card.color === currentColor) return true
  if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true
  if (card.type !== 'number' && card.type === top.type) return true
  return false
}

/**
 * House rule: stacking. While a +2/+4 chain is pending, the only legal
 * plays are cards of that same stack type (any color), a Skip (blocks the
 * stack away entirely — just for the player who played it; nobody draws,
 * and play continues to the next player normally, with no extra player
 * skipped along the way), or a Reverse (redirects the whole stack back to
 * whoever played it) — everything else, including the color/number
 * matching rules above, is suspended until the stack is resolved one of
 * those ways or drawn. Once you've drawn even one card against the stack
 * (mustFinishDrawing), that window has closed — you're committed to
 * drawing the rest, no more countering.
 */
export function isPlayableNow(card, state) {
  if (state.pendingDraw) {
    if (state.mustFinishDrawing) return false
    return card.type === state.pendingDraw.type || card.type === 'skip' || card.type === 'reverse'
  }
  return isPlayable(card, topCard(state), state.currentColor)
}

/**
 * House rule: Jump-In. If Jump-In is enabled and it's currently "open" play
 * (no pending stack/color choice/drawn-card decision blocking things), any
 * card matching the discard pile's top card EXACTLY — same color AND same
 * number/symbol — can be played immediately by whoever holds it, even out
 * of turn. https://matteluno.fandom.com/wiki/Jump-In
 */
export function isJumpInMatch(card, state) {
  if (!state.jumpInEnabled || state.status !== 'playing') return false
  if (state.pendingColorChoice || state.pendingDraw || state.awaitingDrawDecision) return false
  const top = topCard(state)
  if (!top) return false
  return card.color === top.color && card.type === top.type && card.value === top.value
}

export function canJumpIn(state, uid) {
  const hand = state.hands[uid]
  return !!hand && hand.some((c) => isJumpInMatch(c, state))
}

function reshuffleFromDiscard(state) {
  const top = state.discardPile[state.discardPile.length - 1]
  const rest = state.discardPile.slice(0, -1)
  state.drawPile = shuffle(rest)
  state.discardPile = top ? [top] : []
}

/**
 * The draw pile is effectively unlimited: once it and the discard pile both
 * run dry (only possible in freak long stacking chains), a brand new
 * shuffled 108-card deck is manufactured on the fly so a draw can never
 * fail.
 */
function drawOne(state) {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length > 1) {
      reshuffleFromDiscard(state)
    } else {
      state.drawPile = shuffle(buildDeck())
    }
  }
  return state.drawPile.pop()
}

function stepIndex(state, steps) {
  const n = state.playerOrder.length
  let idx = state.currentIndex
  idx = (idx + steps * state.direction + steps * n * 10) % n
  state.currentIndex = idx
}

function currentPlayerId(state) {
  return state.playerOrder[state.currentIndex]
}

/**
 * Creates a fresh round: shuffles a new deck, deals hands, and resolves the
 * flipped starter card per official UNO rules (a Wild Draw Four as the
 * starter is illegal and gets reshuffled back in).
 */
export function createRound(
  players,
  { targetScore = DEFAULT_TARGET_SCORE, jumpInEnabled = false, scores = {}, roundNumber = 1 } = {},
) {
  const playerOrder = players.map((p) => p.uid)
  const hands = {}
  let deck = shuffle(buildDeck())

  for (const uid of playerOrder) hands[uid] = []
  for (let i = 0; i < STARTING_HAND_SIZE; i += 1) {
    for (const uid of playerOrder) {
      hands[uid].push(deck.pop())
    }
  }

  let starter = null
  // Redraw if the flipped card is a Wild Draw Four (illegal starting card).
  while (true) {
    starter = deck.pop()
    if (starter.type !== 'wild4') break
    deck = shuffle([starter, ...deck])
  }

  const nextScores = {}
  for (const uid of playerOrder) nextScores[uid] = scores[uid] ?? 0

  const state = {
    mode: 'classic',
    status: 'playing',
    players,
    playerOrder,
    hands,
    drawPile: deck,
    discardPile: [starter],
    currentColor: starter.color === 'black' ? COLORS[Math.floor(Math.random() * 4)] : starter.color,
    currentIndex: roundNumber > 1 ? (roundNumber - 1) % playerOrder.length : 0,
    direction: 1,
    pendingDraw: null,
    mustFinishDrawing: null,
    jumpInEnabled,
    unoCalled: Object.fromEntries(playerOrder.map((uid) => [uid, false])),
    scores: nextScores,
    targetScore,
    roundNumber,
    lastAction: { type: 'round-start', message: 'New round dealt.' },
    lastDraw: null,
    roundWinner: null,
    roundPoints: 0,
    gameWinner: null,
    awaitingDrawDecision: null,
    pendingColorChoice: null,
    updatedAt: Date.now(),
  }

  applyStarterEffect(state, starter)
  return state
}

function applyStarterEffect(state, starter) {
  const n = state.playerOrder.length
  if (starter.type === 'skip') {
    const blocked = currentPlayerId(state)
    state.currentIndex = (state.currentIndex + 1) % n
    state.lastAction = { type: 'starter-skip', target: blocked, message: `${nameFor(state, blocked)} is blocked to start.` }
  } else if (starter.type === 'reverse') {
    state.direction = -1
    if (n === 2) state.currentIndex = (state.currentIndex + 1) % n
    state.lastAction = { type: 'starter-reverse', message: 'Play starts in reverse order.' }
  } else if (starter.type === 'draw2') {
    // The very first flip applies immediately — nobody has had a turn yet
    // to stack a Draw Two of their own against it.
    const firstId = currentPlayerId(state)
    for (let i = 0; i < DRAW_TWO_PENALTY; i += 1) state.hands[firstId].push(drawOne(state))
    state.currentIndex = (state.currentIndex + 1) % n
    state.lastAction = { type: 'starter-draw2', message: `${nameFor(state, firstId)} draws 2 to start.` }
  } else if (starter.type === 'wild') {
    state.pendingColorChoice = currentPlayerId(state)
    state.lastAction = { type: 'starter-wild', message: `${nameFor(state, currentPlayerId(state))} picks the starting color.` }
  } else {
    state.lastAction = { type: 'starter', message: 'Round dealt.' }
  }
}

function nameFor(state, uid) {
  return state.players.find((p) => p.uid === uid)?.name ?? 'Player'
}

export function chooseStarterColor(state, uid, color) {
  const next = clone(state)
  if (next.pendingColorChoice !== uid) throw new Error('Not your color choice to make.')
  if (!COLORS.includes(color)) throw new Error('Invalid color.')
  next.currentColor = color
  next.pendingColorChoice = null
  next.lastDraw = null
  next.lastAction = { type: 'color-chosen', by: uid, message: `${nameFor(next, uid)} chose ${color}.` }
  next.updatedAt = Date.now()
  return next
}

function clone(state) {
  return JSON.parse(JSON.stringify(state))
}

export function playCard(state, uid, cardId, chosenColor) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.pendingColorChoice) throw new Error('Waiting on starting color choice.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')

  const hand = next.hands[uid]
  const cardIdx = hand.findIndex((c) => c.id === cardId)
  if (cardIdx === -1) throw new Error('Card not in hand.')
  const card = hand[cardIdx]

  const respondingToStack = !!next.pendingDraw
  if (respondingToStack) {
    if (next.mustFinishDrawing) {
      throw new Error(`You already started drawing — finish taking your ${next.pendingDraw.count} card(s) first.`)
    }
    const canStack = card.type === next.pendingDraw.type
    const canBlock = card.type === 'skip'
    const canRedirect = card.type === 'reverse'
    if (!canStack && !canBlock && !canRedirect) {
      const label = next.pendingDraw.type === 'wild4' ? 'Wild +4' : '+2'
      throw new Error(`You must stack another ${label}, block with Skip, redirect with Reverse, or draw ${next.pendingDraw.count} cards.`)
    }
  } else if (!isPlayable(card, topCard(next), next.currentColor)) {
    throw new Error('Card does not match color, number, or type.')
  }
  if ((card.type === 'wild' || card.type === 'wild4') && !COLORS.includes(chosenColor)) {
    throw new Error('Choose a color for the wild card.')
  }

  hand.splice(cardIdx, 1)
  next.discardPile.push(card)
  next.awaitingDrawDecision = null
  next.lastDraw = null
  next.currentColor = card.color === 'black' ? chosenColor : card.color

  // Hand empty -> round over, scoring happens before any turn advance (and
  // before any pending stack would apply to whoever's next).
  if (hand.length === 0) {
    finishRound(next, uid)
    next.updatedAt = Date.now()
    return next
  }

  // Note: unoCalled is intentionally NOT reset here when hand.length === 1.
  // A player who calls UNO pre-emptively (while still holding 2 cards, right
  // before playing this one) must have that call stick — resetting it here
  // would silently erase a legitimate early call. It starts false each round
  // and only flips true via callUno/catchUno, which is exactly the state we
  // want once the hand reaches 1.

  const n = next.playerOrder.length

  if (card.type === 'number') {
    stepIndex(next, 1)
    next.lastAction = { type: 'play', by: uid, card, message: `${nameFor(next, uid)} played ${describeCard(card)}.` }
  } else if (card.type === 'skip') {
    if (respondingToStack) {
      // Blocks the stack only for the player who played it — the stack is
      // simply gone, and play continues to the next player normally, with
      // no extra player skipped along the way (that's what a Skip does on
      // a normal turn, but not here).
      const label = next.pendingDraw.type === 'wild4' ? 'Wild +4' : '+2'
      next.pendingDraw = null
      stepIndex(next, 1)
      next.lastAction = {
        type: 'block-skip',
        by: uid,
        card,
        message: `${nameFor(next, uid)} blocks the ${label} with Skip!`,
      }
    } else {
      const blocked = next.playerOrder[(next.currentIndex + next.direction + n * 10) % n]
      stepIndex(next, 2)
      next.lastAction = { type: 'skip', by: uid, target: blocked, card, message: `${nameFor(next, blocked)} is blocked!` }
    }
  } else if (card.type === 'reverse') {
    if (respondingToStack) {
      const label = next.pendingDraw.type === 'wild4' ? 'Wild +4' : '+2'
      next.direction *= -1
      stepIndex(next, 1) // lands exactly on whoever stacked it onto uid
      next.lastAction = { type: 'redirect-reverse', by: uid, card, message: `${nameFor(next, uid)} redirects the ${label} back with Reverse!` }
    } else {
      next.direction *= -1
      stepIndex(next, n === 2 ? 2 : 1)
      next.lastAction = { type: 'reverse', by: uid, card, message: `${nameFor(next, uid)} played Reverse.` }
    }
  } else if (card.type === 'draw2') {
    const stacked = !!next.pendingDraw
    next.pendingDraw = { type: 'draw2', count: (next.pendingDraw?.count ?? 0) + DRAW_TWO_PENALTY }
    stepIndex(next, 1)
    next.lastAction = {
      type: 'stack-draw2',
      by: uid,
      card,
      message: stacked
        ? `${nameFor(next, uid)} stacks +2 (now ${next.pendingDraw.count})!`
        : `${nameFor(next, uid)} played +2.`,
    }
  } else if (card.type === 'wild') {
    stepIndex(next, 1)
    next.lastAction = { type: 'wild', by: uid, card, message: `${nameFor(next, uid)} played Wild (${chosenColor}).` }
  } else if (card.type === 'wild4') {
    const stacked = !!next.pendingDraw
    next.pendingDraw = { type: 'wild4', count: (next.pendingDraw?.count ?? 0) + WILD_DRAW_FOUR_PENALTY }
    stepIndex(next, 1)
    next.lastAction = {
      type: 'stack-wild4',
      by: uid,
      card,
      message: stacked
        ? `${nameFor(next, uid)} stacks +4 (now ${next.pendingDraw.count}, ${chosenColor})!`
        : `${nameFor(next, uid)} played Wild +4 (${chosenColor}).`,
    }
  }

  next.updatedAt = Date.now()
  return next
}

/**
 * Plays a card out of turn (see isJumpInMatch above). "Play immediately
 * proceeds to the player after the person who jumped in" — implemented by
 * jumping the turn to the jumper first, then running the exact same
 * playCard logic as a normal turn from there.
 */
export function jumpIn(state, uid, cardId, chosenColor) {
  if (!isJumpInMatch(state.hands[uid]?.find((c) => c.id === cardId), state)) {
    throw new Error('That card cannot jump in right now.')
  }
  if (currentPlayerId(state) === uid) throw new Error('It is already your turn — just play it normally.')

  const jumped = clone(state)
  jumped.currentIndex = jumped.playerOrder.indexOf(uid)
  const result = playCard(jumped, uid, cardId, chosenColor)
  if (result.lastAction) {
    result.lastAction = {
      ...result.lastAction,
      jumpIn: true,
      message: `${nameFor(result, uid)} jumps in! ${result.lastAction.message}`,
    }
  }
  return result
}

function describeCard(card) {
  if (card.type === 'number') return `${card.color} ${card.value}`
  if (card.type === 'wild') return 'Wild'
  if (card.type === 'wild4') return 'Wild +4'
  return `${card.color} ${card.label}`
}

function finishRound(state, winnerId) {
  let roundPoints = 0
  for (const uid of state.playerOrder) {
    if (uid === winnerId) continue
    roundPoints += handPoints(state.hands[uid])
  }
  state.scores[winnerId] = (state.scores[winnerId] ?? 0) + roundPoints
  state.roundWinner = winnerId
  state.roundPoints = roundPoints
  state.status = 'round-over'
  state.lastAction = { type: 'round-over', by: winnerId, message: `${nameFor(state, winnerId)} went out and scores ${roundPoints}!` }
  if (state.scores[winnerId] >= state.targetScore) {
    state.status = 'game-over'
    state.gameWinner = winnerId
  }
}

/**
 * Draws exactly one card for `uid` — every forced or optional draw takes its
 * own call, so a player (or the AFK auto-player) clicks/acts once per card.
 * Two distinct situations:
 *  - A pending +2/+4 stack: this card counts against the total. Once the
 *    whole total has been drawn the stack clears and the turn passes; until
 *    then it's still their turn and they must draw again (no choice to play
 *    — the stack already gave them the chance to counter it).
 *  - A normal turn with no playable card: house rule — drawing doesn't pass
 *    your turn. If the card you drew isn't playable either, it's still your
 *    turn and you must draw again; once you draw something playable you may
 *    play it or keep it (the deck is unlimited, so this always terminates).
 */
export function drawCard(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.pendingColorChoice) throw new Error('Waiting on starting color choice.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.awaitingDrawDecision) throw new Error('Resolve your drawn card first.')

  const card = drawOne(next)
  next.hands[uid].push(card)

  // Growing back out of the "1 or 2 cards" zone clears any earlier UNO call
  // — if they reach 1 card again later they'll need to call again.
  if (next.hands[uid].length >= 3) next.unoCalled[uid] = false

  if (next.pendingDraw) {
    const { type } = next.pendingDraw
    const remaining = next.pendingDraw.count - 1
    next.lastDraw = { id: Date.now(), by: uid, cardIds: [card.id], forced: true }
    if (remaining <= 0) {
      next.pendingDraw = null
      next.mustFinishDrawing = null
      stepIndex(next, 1)
      next.lastAction = {
        type: 'forced-draw',
        by: uid,
        message: `${nameFor(next, uid)} finishes drawing the ${type === 'wild4' ? 'Wild +4' : '+2'} stack and is skipped.`,
      }
    } else {
      next.pendingDraw = { type, count: remaining }
      // Drawing even one card against the stack forfeits any further
      // chance to counter it — locks in until the whole amount is taken.
      next.mustFinishDrawing = uid
      next.lastAction = {
        type: 'forced-draw-partial',
        by: uid,
        message: `${nameFor(next, uid)} draws one (${remaining} more to go)...`,
      }
    }
    next.updatedAt = Date.now()
    return next
  }

  next.lastDraw = { id: Date.now(), by: uid, cardIds: [card.id], forced: false }

  if (isPlayable(card, topCard(next), next.currentColor)) {
    next.awaitingDrawDecision = uid
    next.lastAction = { type: 'draw', by: uid, message: `${nameFor(next, uid)} drew a card.` }
  } else {
    next.lastAction = { type: 'draw-again', by: uid, message: `${nameFor(next, uid)} drew a card — no play, draw again.` }
  }
  next.updatedAt = Date.now()
  return next
}

export function passTurn(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.awaitingDrawDecision !== uid) throw new Error('Nothing to pass on.')
  next.awaitingDrawDecision = null
  next.lastDraw = null
  stepIndex(next, 1)
  next.lastAction = { type: 'pass', by: uid, message: `${nameFor(next, uid)} passed.` }
  next.updatedAt = Date.now()
  return next
}

export function callUno(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  const hand = next.hands[uid]
  if (!hand) throw new Error('Unknown player.')
  // Strict rule: you may only call UNO in the moment you're about to play
  // your second-to-last card — i.e. it's your turn, you're holding exactly
  // two cards, and at least one of them is actually legal to play right
  // now. Once you've played it (down to one card) this can't be called
  // retroactively; the call itself is what needs to happen at that moment.
  // With Jump-In enabled, "about to play" also covers jumping in out of
  // turn — you may call the instant before you jump in too.
  const isMyTurn = actionableUid(next) === uid
  const jumpEligible = !isMyTurn && canJumpIn(next, uid)
  if (!isMyTurn && !jumpEligible) throw new Error('You can only call UNO on your turn (or when jumping in).')
  if (hand.length !== 2) throw new Error('You can only call UNO right before playing your second-to-last card.')
  if (isMyTurn && !hand.some((c) => isPlayableNow(c, next))) {
    throw new Error('You need a legal play to call UNO.')
  }
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
  next.updatedAt = Date.now()
  return next
}

export function startNextRound(state) {
  if (state.status !== 'round-over') throw new Error('Current round has not finished.')
  return createRound(state.players, {
    targetScore: state.targetScore,
    jumpInEnabled: state.jumpInEnabled,
    scores: state.scores,
    roundNumber: state.roundNumber + 1,
  })
}

export function isMyTurn(state, uid) {
  return state.status === 'playing' && !state.pendingColorChoice && currentPlayerId(state) === uid
}

/** Whoever the game is currently waiting on to take *some* action. */
export function actionableUid(state) {
  if (state.status !== 'playing') return null
  if (state.pendingColorChoice) return state.pendingColorChoice
  if (state.awaitingDrawDecision) return state.awaitingDrawDecision
  return currentPlayerId(state)
}

export { currentPlayerId }
