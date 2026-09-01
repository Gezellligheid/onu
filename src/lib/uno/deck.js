import { COLORS, CARD_POINTS } from './constants.js'

let uid = 0
function nextId() {
  uid += 1
  return `c${uid}-${Math.random().toString(36).slice(2, 7)}`
}

function numberCard(color, value) {
  return { id: nextId(), color, type: 'number', value, label: String(value) }
}

function actionCard(color, type, label) {
  return { id: nextId(), color, type, value: null, label }
}

function wildCard(type, label) {
  return { id: nextId(), color: 'black', type, value: null, label }
}

/**
 * Builds the standard 108-card UNO deck:
 * per color -> one 0, two each of 1-9, two Skip, two Reverse, two Draw Two
 * plus 4 Wild and 4 Wild Draw Four.
 */
export function buildDeck() {
  const cards = []
  for (const color of COLORS) {
    cards.push(numberCard(color, 0))
    for (let v = 1; v <= 9; v += 1) {
      cards.push(numberCard(color, v))
      cards.push(numberCard(color, v))
    }
    for (let i = 0; i < 2; i += 1) {
      cards.push(actionCard(color, 'skip', 'Skip'))
      cards.push(actionCard(color, 'reverse', 'Reverse'))
      cards.push(actionCard(color, 'draw2', '+2'))
    }
  }
  for (let i = 0; i < 4; i += 1) {
    cards.push(wildCard('wild', 'Wild'))
    cards.push(wildCard('wild4', 'Wild +4'))
  }
  return cards
}

export function shuffle(cards) {
  const arr = cards.slice()
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function cardPoints(card) {
  if (card.type === 'number') return CARD_POINTS.number(card.value)
  return CARD_POINTS[card.type] ?? 0
}

export function handPoints(hand) {
  return hand.reduce((sum, card) => sum + cardPoints(card), 0)
}
