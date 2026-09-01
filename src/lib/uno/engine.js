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

function reshuffleFromDiscard(state) {
  const top = state.discardPile[state.discardPile.length - 1]
  const rest = state.discardPile.slice(0, -1).map((c) => ({ ...c, color: c.color === 'black' ? 'black' : c.color }))
  // Wild cards return to the deck as wild (color reset happens naturally since we never mutate .color on wilds)
  state.drawPile = shuffle(rest)
  state.discardPile = top ? [top] : []
}

function drawOne(state) {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length <= 1) {
      // Extremely rare: nothing left to reshuffle. Manufacture a fresh deck minus the top card.
      const fresh = shuffle(buildDeck())
      state.drawPile = fresh
    } else {
      reshuffleFromDiscard(state)
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
export function createRound(players, { targetScore = DEFAULT_TARGET_SCORE, scores = {}, roundNumber = 1 } = {}) {
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
    status: 'playing',
    players,
    playerOrder,
    hands,
    drawPile: deck,
    discardPile: [starter],
    currentColor: starter.color === 'black' ? COLORS[Math.floor(Math.random() * 4)] : starter.color,
    currentIndex: roundNumber > 1 ? (roundNumber - 1) % playerOrder.length : 0,
    direction: 1,
    unoCalled: Object.fromEntries(playerOrder.map((uid) => [uid, false])),
    scores: nextScores,
    targetScore,
    roundNumber,
    lastAction: { type: 'round-start', message: 'New round dealt.' },
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
    state.currentIndex = (state.currentIndex + 1) % n
    state.lastAction = { type: 'starter-skip', message: `${nameFor(state, currentPlayerId(state))} is skipped to start.` }
  } else if (starter.type === 'reverse') {
    state.direction = -1
    if (n === 2) state.currentIndex = (state.currentIndex + 1) % n
    state.lastAction = { type: 'starter-reverse', message: 'Play starts in reverse order.' }
  } else if (starter.type === 'draw2') {
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
  next.lastAction = { type: 'color-chosen', message: `${nameFor(next, uid)} chose ${color}.` }
  return next
}

function clone(state) {
  return JSON.parse(JSON.stringify(state))
}

export function playCard(state, uid, cardId, chosenColor) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.pendingColorChoice) throw new Error('Waiting on starting color choice.')
  if (currentPlayerId(next) !== uid) throw new Error("It is not your turn.")

  const hand = next.hands[uid]
  const cardIdx = hand.findIndex((c) => c.id === cardId)
  if (cardIdx === -1) throw new Error('Card not in hand.')
  const card = hand[cardIdx]
  const top = topCard(next)

  if (!isPlayable(card, top, next.currentColor)) throw new Error('Card does not match color, number, or type.')
  if ((card.type === 'wild' || card.type === 'wild4') && !COLORS.includes(chosenColor)) {
    throw new Error('Choose a color for the wild card.')
  }

  hand.splice(cardIdx, 1)
  next.discardPile.push(card)
  next.awaitingDrawDecision = null

  const n = next.playerOrder.length
  next.currentColor = card.color === 'black' ? chosenColor : card.color

  // Hand empty -> round over, scoring happens before any turn advance.
  if (hand.length === 0) {
    finishRound(next, uid)
    return next
  }

  if (hand.length === 1) {
    next.unoCalled[uid] = false
  }

  if (card.type === 'number') {
    stepIndex(next, 1)
    next.lastAction = { type: 'play', by: uid, card, message: `${nameFor(next, uid)} played ${describeCard(card)}.` }
  } else if (card.type === 'skip') {
    stepIndex(next, 2)
    next.lastAction = { type: 'skip', by: uid, card, message: `${nameFor(next, uid)} played Skip.` }
  } else if (card.type === 'reverse') {
    next.direction *= -1
    stepIndex(next, n === 2 ? 2 : 1)
    next.lastAction = { type: 'reverse', by: uid, card, message: `${nameFor(next, uid)} played Reverse.` }
  } else if (card.type === 'draw2') {
    stepIndex(next, 1)
    const victim = currentPlayerId(next)
    for (let i = 0; i < DRAW_TWO_PENALTY; i += 1) next.hands[victim].push(drawOne(next))
    stepIndex(next, 1)
    next.lastAction = { type: 'draw2', by: uid, target: victim, card, message: `${nameFor(next, victim)} draws 2 and is skipped.` }
  } else if (card.type === 'wild') {
    stepIndex(next, 1)
    next.lastAction = { type: 'wild', by: uid, card, message: `${nameFor(next, uid)} played Wild (${chosenColor}).` }
  } else if (card.type === 'wild4') {
    stepIndex(next, 1)
    const victim = currentPlayerId(next)
    for (let i = 0; i < WILD_DRAW_FOUR_PENALTY; i += 1) next.hands[victim].push(drawOne(next))
    stepIndex(next, 1)
    next.lastAction = {
      type: 'wild4',
      by: uid,
      target: victim,
      card,
      message: `${nameFor(next, victim)} draws 4 and is skipped (${chosenColor}).`,
    }
  }

  return next
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

export function drawCard(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (next.pendingColorChoice) throw new Error('Waiting on starting color choice.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.awaitingDrawDecision) throw new Error('Resolve your drawn card first.')

  const card = drawOne(next)
  next.hands[uid].push(card)
  const playable = isPlayable(card, topCard(next), next.currentColor)

  if (playable) {
    next.awaitingDrawDecision = uid
    next.lastAction = { type: 'draw', by: uid, message: `${nameFor(next, uid)} drew a card.` }
  } else {
    stepIndex(next, 1)
    next.lastAction = { type: 'draw-pass', by: uid, message: `${nameFor(next, uid)} drew a card and passed.` }
  }
  return next
}

export function passTurn(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (currentPlayerId(next) !== uid) throw new Error('It is not your turn.')
  if (next.awaitingDrawDecision !== uid) throw new Error('Nothing to pass on.')
  next.awaitingDrawDecision = null
  stepIndex(next, 1)
  next.lastAction = { type: 'pass', by: uid, message: `${nameFor(next, uid)} passed.` }
  return next
}

export function callUno(state, uid) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (!next.hands[uid]) throw new Error('Unknown player.')
  next.unoCalled[uid] = true
  next.lastAction = { type: 'uno-call', by: uid, message: `${nameFor(next, uid)} called UNO!` }
  return next
}

export function catchUno(state, catcherId, targetId) {
  const next = clone(state)
  if (next.status !== 'playing') throw new Error('Round is not active.')
  if (targetId === catcherId) throw new Error('You cannot catch yourself.')
  const hand = next.hands[targetId]
  if (!hand || hand.length !== 1) throw new Error('That player is not sitting on one card.')
  if (next.unoCalled[targetId]) throw new Error('They already called UNO.')

  for (let i = 0; i < NO_UNO_CALL_PENALTY; i += 1) hand.push(drawOne(next))
  next.unoCalled[targetId] = true
  next.lastAction = {
    type: 'uno-caught',
    by: catcherId,
    target: targetId,
    message: `${nameFor(next, catcherId)} caught ${nameFor(next, targetId)} without UNO! +2 cards.`,
  }
  return next
}

export function startNextRound(state) {
  if (state.status !== 'round-over') throw new Error('Current round has not finished.')
  return createRound(state.players, {
    targetScore: state.targetScore,
    scores: state.scores,
    roundNumber: state.roundNumber + 1,
  })
}

export function isMyTurn(state, uid) {
  return state.status === 'playing' && !state.pendingColorChoice && currentPlayerId(state) === uid
}

export { currentPlayerId }
