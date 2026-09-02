import { COLORS, COLORED_ACTION_TYPES, WILD_TYPES, CARD_POINTS } from './constants.js'

let uid = 0
function nextId() {
  uid += 1
  return `nm${uid}-${Math.random().toString(36).slice(2, 7)}`
}

const ACTION_LABELS = {
  skip: 'Skip',
  reverse: 'Reverse',
  draw2: '+2',
  draw4: '+4',
  discardAll: 'Discard All',
  skipEveryone: 'Skip All',
}
const WILD_LABELS = {
  wildReverseDraw4: 'Wild Rev +4',
  wildDraw6: '+6',
  wildDraw10: '+10',
  wildColorRoulette: 'Roulette',
}

function numberCard(color, value) {
  return { id: nextId(), color, type: 'number', value, label: String(value), nm: true }
}

function actionCard(color, type) {
  return { id: nextId(), color, type, value: null, label: ACTION_LABELS[type], nm: true }
}

function wildCard(type) {
  return { id: nextId(), color: 'black', type, value: null, label: WILD_LABELS[type], nm: true }
}

/**
 * Builds the 168-card UNO No Mercy deck:
 * per color -> one 0, two each of 1-9 (76 total), three each of
 * Skip/Reverse/Draw2/Draw4/DiscardAll/SkipEveryone (72 total),
 * plus 5 of each of the 4 wild types (20 total).
 */
export function buildDeck() {
  const cards = []
  for (const color of COLORS) {
    cards.push(numberCard(color, 0))
    for (let v = 1; v <= 9; v += 1) {
      cards.push(numberCard(color, v))
      cards.push(numberCard(color, v))
    }
    for (const type of COLORED_ACTION_TYPES) {
      for (let i = 0; i < 3; i += 1) cards.push(actionCard(color, type))
    }
  }
  for (const type of WILD_TYPES) {
    for (let i = 0; i < 5; i += 1) cards.push(wildCard(type))
  }
  return cards
}

export function cardPoints(card) {
  if (card.type === 'number') return CARD_POINTS.number(card.value)
  return CARD_POINTS[card.type] ?? 0
}

export function handPoints(hand) {
  return hand.reduce((sum, card) => sum + cardPoints(card), 0)
}
