import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  collection,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { getEngine } from './uno/modes.js'
import { DEFAULT_TARGET_SCORE, MIN_PLAYERS } from './uno/constants.js'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I to avoid ambiguity

function generateInviteCode(length = 5) {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

function roomRef(code) {
  return doc(db, 'rooms', code.toUpperCase())
}

function requireDb() {
  if (!db) throw new Error('Firebase is not configured. Add your keys to .env and restart the dev server.')
}

export async function createRoom({
  uid,
  name,
  targetScore = DEFAULT_TARGET_SCORE,
  mode = 'classic',
  mercyLimit,
  jumpInEnabled = false,
}) {
  requireDb()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateInviteCode()
    const ref = roomRef(code)
    const existing = await getDoc(ref)
    if (existing.exists()) continue
    await setDoc(ref, {
      code,
      hostUid: uid,
      status: 'lobby',
      createdAt: serverTimestamp(),
      targetScore,
      mode,
      // Only meaningful for No Mercy (the Mercy elimination threshold), but
      // harmless to always store — classic's createRound ignores it.
      ...(mercyLimit ? { mercyLimit } : {}),
      jumpInEnabled,
      players: [{ uid, name, joinedAt: Date.now() }],
      game: null,
    })
    return code
  }
  throw new Error('Could not generate a free invite code, try again.')
}

export async function joinRoom({ code, uid, name }) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('No room found with that invite code.')
    const room = snap.data()
    if (room.status !== 'lobby') throw new Error('This game has already started.')
    const already = room.players.some((p) => p.uid === uid)
    if (already) {
      const players = room.players.map((p) => (p.uid === uid ? { ...p, name } : p))
      tx.update(ref, { players })
      return
    }
    tx.update(ref, { players: [...room.players, { uid, name, joinedAt: Date.now() }] })
  })
  return code.toUpperCase()
}

export async function leaveRoom({ code, uid }) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const room = snap.data()
    const players = room.players.filter((p) => p.uid !== uid)
    if (players.length === 0) {
      tx.delete(ref)
      return
    }
    const patch = { players }
    if (room.hostUid === uid) patch.hostUid = players[0].uid
    tx.update(ref, patch)
  })
}

export function subscribeRoom(code, callback, onError) {
  requireDb()
  return onSnapshot(
    roomRef(code),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  )
}

export async function startGame({ code, hostUid }) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room not found.')
    const room = snap.data()
    if (room.hostUid !== hostUid) throw new Error('Only the host can start the game.')
    if (room.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players.`)
    const engine = getEngine(room.mode)
    const game = engine.createRound(room.players, {
      targetScore: room.targetScore,
      mercyLimit: room.mercyLimit,
      jumpInEnabled: room.jumpInEnabled,
    })
    tx.update(ref, { status: 'playing', game })
  })
}

async function mutateGame(code, mutator) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room not found.')
    const room = snap.data()
    if (!room.game) throw new Error('Game has not started.')
    const engine = getEngine(room.game.mode)
    const nextGame = mutator(engine, room.game)
    const patch = { game: nextGame }
    if (nextGame.status === 'game-over') patch.status = 'finished'
    tx.update(ref, patch)
  })
}

export const playCard = (code, uid, cardId, chosenColor, swapTargetUid) =>
  mutateGame(code, (engine, game) => engine.playCard(game, uid, cardId, chosenColor, swapTargetUid))

// House rule: playing a card out of turn when it matches the top of the
// discard pile exactly. Only meaningful when the room's jumpInEnabled flag
// was on at round creation — the engine itself enforces that.
export const jumpIn = (code, uid, cardId, chosenColor, swapTargetUid) =>
  mutateGame(code, (engine, game) => engine.jumpIn(game, uid, cardId, chosenColor, swapTargetUid))

export const drawCard = (code, uid) => mutateGame(code, (engine, game) => engine.drawCard(game, uid))

// Classic-only: no "keep and pass" choice exists in No Mercy.
export const passTurn = (code, uid) => mutateGame(code, (engine, game) => engine.passTurn(game, uid))

export const callUno = (code, uid) => mutateGame(code, (engine, game) => engine.callUno(game, uid))

export const catchUno = (code, catcherId, targetId) =>
  mutateGame(code, (engine, game) => engine.catchUno(game, catcherId, targetId))

// Classic-only: the No Mercy starter never lands on a Wild (it's reshuffled
// away like every other action/wild starter), so there's no starting-color
// choice to make in that mode.
export const chooseStarterColor = (code, uid, color) =>
  mutateGame(code, (engine, game) => engine.chooseStarterColor(game, uid, color))

// No Mercy-only: resolving a pending Wild Color Roulette pick.
export const chooseRouletteColor = (code, uid, color) =>
  mutateGame(code, (engine, game) => engine.chooseRouletteColor(game, uid, color))

export async function startNextRound(code) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('Room not found.')
    const room = snap.data()
    if (!room.game) throw new Error('Game has not started.')
    const engine = getEngine(room.game.mode)
    const nextGame = engine.startNextRound(room.game)
    tx.update(ref, { status: 'playing', game: nextGame })
  })
}

export async function returnToLobby(code) {
  requireDb()
  const ref = roomRef(code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    tx.update(ref, { status: 'lobby', game: null })
  })
}

export function roomsCollectionRef() {
  requireDb()
  return collection(db, 'rooms')
}
