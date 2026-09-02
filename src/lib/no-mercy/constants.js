// UNO Show 'Em No Mercy — rules taken from the official Mattel instruction
// sheet (HVW18-Eng), 168-card deck.

export const COLORS = ['red', 'yellow', 'green', 'blue']

export const COLOR_HEX = {
  red: '#ED1C24',
  yellow: '#FFD500',
  green: '#3AA655',
  blue: '#0072CE',
  black: '#1a1a1a',
}

export const STARTING_HAND_SIZE = 7
export const MIN_PLAYERS = 2

// No Mercy round scores run much higher than classic (a single knockout is
// worth 250 on its own), so the official rules suggest playing to 1000.
export const DEFAULT_TARGET_SCORE = 1000
export const TARGET_SCORE_OPTIONS = [500, 1000, 1500]

export const MERCY_LIMIT = 25 // hand size at which a player is knocked out
export const KNOCKOUT_BONUS = 250 // awarded to the round winner per player knocked out
export const NO_UNO_CALL_PENALTY = 2

// Colored action cards (match by color/number/symbol like a number card).
// Counts are per color and were hand-verified against the actual card sheet
// (counted off every printed copy, not assumed) — they are NOT uniform:
// Draw Four and Skip Everyone only get 2 copies per color, the rest get 3.
export const COLORED_ACTION_TYPES = ['skip', 'reverse', 'draw2', 'draw4', 'discardAll', 'skipEveryone']
export const COLORED_ACTION_COUNTS = {
  skip: 3,
  reverse: 3,
  draw2: 3,
  draw4: 2,
  discardAll: 3,
  skipEveryone: 2,
}
// Wild cards (color: 'black', always playable). Per the official rules sheet
// there is no plain "Wild" card in this deck, and none of these four cards
// have a color-choice step — Wild Color Roulette's "choose a color" is made
// by the NEXT player (to hunt for during the reveal), not by whoever plays
// it. Counts are hand-verified off the card sheet and are NOT uniform:
// Wild Reverse Draw 4 and Wild Color Roulette get 8 copies each, Wild Draw 6
// and Wild Draw 10 get 4 each (24 total).
export const WILD_TYPES = ['wildReverseDraw4', 'wildDraw6', 'wildDraw10', 'wildColorRoulette']
export const WILD_COUNTS = {
  wildReverseDraw4: 8,
  wildColorRoulette: 8,
  wildDraw6: 4,
  wildDraw10: 4,
}

// The "draw value" a Draw-type card carries for the value-tiered stacking
// rule — a card can stack onto a pending draw if its own value is >= it.
export const DRAW_VALUE = {
  draw2: 2,
  draw4: 4,
  wildReverseDraw4: 4,
  wildDraw6: 6,
  wildDraw10: 10,
}

export const CARD_POINTS = {
  number: (value) => value,
  ...Object.fromEntries(COLORED_ACTION_TYPES.map((t) => [t, 20])),
  ...Object.fromEntries(WILD_TYPES.map((t) => [t, 50])),
}
