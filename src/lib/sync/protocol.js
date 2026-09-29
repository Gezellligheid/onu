// Action names line up 1:1 with the method names exported by each rules
// engine (src/lib/uno/engine.js, src/lib/no-mercy/engine.js) — this lets the
// host dispatch generically by name instead of maintaining a mapping table.
export const GAME_ACTION_NAMES = [
  'playCard',
  'jumpIn',
  'drawCard',
  'passTurn',
  'callUno',
  'catchUno',
  'chooseStarterColor',
  'chooseRouletteColor',
]

// Phase transitions aren't plain engine calls (different signatures, or no
// engine involvement at all for returnToLobby) but still flow through the
// same host-authoritative dispatch path.
export const PHASE_ACTION_NAMES = ['startGame', 'startNextRound', 'returnToLobby']

export const ALL_ACTION_NAMES = [...GAME_ACTION_NAMES, ...PHASE_ACTION_NAMES]

export const REQUEST_TIMEOUT_MS = 8000

// Firestore doc shapes (see hostSession.js / peerSession.js):
//   rooms/{code}                    { status, game, hostHeartbeat, ... lobby fields }
//   rooms/{code}/actions/{reqId}     peer -> host: { uid, action, args, createdAt }
//                                    host -> peer: same doc, merged with { result: { ok, message? } }
