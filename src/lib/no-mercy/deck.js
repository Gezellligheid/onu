import { COLORS, COLORED_ACTION_TYPES, COLORED_ACTION_COUNTS, WILD_TYPES, WILD_COUNTS, CARD_POINTS } from './constants.js'

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
 * Builds the 168-card UNO No Mercy deck. Every count here was hand-verified
 * off the actual printed card sheet (not assumed from classic UNO's ratios):
 * per color -> two each of 0-9 (80 total, NOT "one 0" like classic), plus
 * COLORED_ACTION_COUNTS copies of each colored action (64 total), plus
 * WILD_COUNTS copies of each wild (24 total). 80 + 64 + 24 = 168.
 */
export function buildDeck() {
  const cards = []
  for (const color of COLORS) {
    for (let v = 0; v <= 9; v += 1) {
      cards.push(numberCard(color, v))
      cards.push(numberCard(color, v))
    }
    for (const type of COLORED_ACTION_TYPES) {
      for (let i = 0; i < COLORED_ACTION_COUNTS[type]; i += 1) cards.push(actionCard(color, type))
    }
  }
  for (const type of WILD_TYPES) {
    for (let i = 0; i < WILD_COUNTS[type]; i += 1) cards.push(wildCard(type))
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
