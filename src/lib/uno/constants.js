export const COLORS = ['red', 'yellow', 'green', 'blue']

export const COLOR_HEX = {
  red: '#ED1C24',
  yellow: '#FFD500',
  green: '#3AA655',
  blue: '#0072CE',
  black: '#1a1a1a',
}

// Point values per unorules.com scoring table, used both for catching a
// player who forgot to call UNO (draw penalty) and for end-of-round scoring.
export const CARD_POINTS = {
  number: (value) => value,
  skip: 20,
  reverse: 20,
  draw2: 20,
  wild: 40,
  wild4: 50,
}

export const DRAW_TWO_PENALTY = 2
export const WILD_DRAW_FOUR_PENALTY = 4
export const NO_UNO_CALL_PENALTY = 2
export const STARTING_HAND_SIZE = 7
export const MIN_PLAYERS = 2

export const DEFAULT_TARGET_SCORE = 500
