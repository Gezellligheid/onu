import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  collection,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { DEFAULT_TARGET_SCORE } from './uno/constants.js'
import { PartySession } from './sync/partySession.js'

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
    // Mid-game joins are allowed — a newcomer sits out as a spectator (see
    // GameBoard's isSpectator) until the host deals the next round, which
    // re-seats off the room's current player list. Only a fully finished
    // match (status mirrors the PartyKit room's status: lobby | playing |
    // finished, forwarded by the host — see PartySession#updateConfig)
    // turns away new joiners.
    if (room.status === 'finished') throw new Error('This game has already finished.')
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

// Discord Activities: every participant launched into the same voice-channel
// activity instance shares one Discord `instance_id` (see src/discord.js),
// so it doubles as the room's invite code — no code to type or share. First
// participant in creates the room; everyone after joins it. A `finished`
// room is reset instead of reused, since relaunching the activity in the
// same channel is the closest thing Discord users have to "play again."
export async function ensureDiscordRoom({ code, uid, name }) {
  requireDb()
  const upper = code.toUpperCase()
  const ref = roomRef(upper)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists() || snap.data().status === 'finished') {
      tx.set(ref, {
        code: upper,
        hostUid: uid,
        status: 'lobby',
        createdAt: serverTimestamp(),
        targetScore: DEFAULT_TARGET_SCORE,
        mode: 'classic',
        jumpInEnabled: false,
        players: [{ uid, name, joinedAt: Date.now() }],
        game: null,
      })
      return
    }
    const room = snap.data()
    const already = room.players.some((p) => p.uid === uid)
    if (already) {
      const players = room.players.map((p) => (p.uid === uid ? { ...p, name } : p))
      tx.update(ref, { players })
      return
    }
    tx.update(ref, { players: [...room.players, { uid, name, joinedAt: Date.now() }] })
  })
  return upper
}

// Host-only (enforced in the UI — see WaitingRoom.vue's isHost gate) lobby
// settings edit, for rooms that skipped the create-time settings form (e.g.
// Discord's auto-bound rooms, which always start Classic) or whose host
// just changed their mind before starting.
export async function updateRoomSettings({ code, mode, targetScore, mercyLimit, jumpInEnabled }) {
  requireDb()
  const patch = { mode, targetScore, jumpInEnabled }
  if (mode === 'no-mercy') patch.mercyLimit = mercyLimit
  await updateDoc(roomRef(code), patch)
}

export function subscribeRoom(code, callback, onError) {
  requireDb()
  return onSnapshot(
    roomRef(code),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  )
}

// ---- Game session lifecycle ----
// The engine is authoritative on PartyKit (party/uno.js), not in any
// player's browser — see src/lib/sync/partySession.js for the transport.
// Firestore only ever sees `status`, mirrored by the host below, so a late
// joiner's "already finished" check (joinRoom above) still works without
// PartyKit needing to touch Firestore at all.

let session = null

export function connectSession({ code, uid, isHost, onGameState, onConnectionStatus }) {
  requireDb()
  disconnectSession()
  let lastMirroredStatus = null
  session = new PartySession({
    code,
    uid,
    isHost,
    onStateChange: (status, game) => {
      onGameState(status, game)
      if (isHost && status !== lastMirroredStatus) {
        lastMirroredStatus = status
        updateDoc(roomRef(code), { status }).catch(() => {})
      }
    },
    onConnectionStatus,
  })
}

export function disconnectSession() {
  if (session) session.destroy()
  session = null
}

export function syncSessionConfig(lobbyDoc) {
  if (session instanceof PartySession) session.updateConfig(lobbyDoc)
}

function dispatch(action, args) {
  if (!session) return Promise.reject(new Error('Not connected to the room.'))
  return session.dispatch(action, args)
}

export async function startGame({ hostUid }) {
  return dispatch('startGame', [hostUid])
}

export const playCard = (code, uid, cardId, chosenColor, swapTargetUid) =>
  dispatch('playCard', [uid, cardId, chosenColor, swapTargetUid])

// House rule: playing a card out of turn when it matches the top of the
// discard pile exactly. Only meaningful when the room's jumpInEnabled flag
// was on at round creation — the engine itself enforces that.
export const jumpIn = (code, uid, cardId, chosenColor, swapTargetUid) =>
  dispatch('jumpIn', [uid, cardId, chosenColor, swapTargetUid])

export const drawCard = (code, uid) => dispatch('drawCard', [uid])

// Classic-only: no "keep and pass" choice exists in No Mercy.
export const passTurn = (code, uid) => dispatch('passTurn', [uid])

export const callUno = (code, uid) => dispatch('callUno', [uid])

export const catchUno = (code, catcherId, targetId) => dispatch('catchUno', [catcherId, targetId])

// Classic-only: the No Mercy starter never lands on a Wild (it's reshuffled
// away like every other action/wild starter), so there's no starting-color
// choice to make in that mode.
export const chooseStarterColor = (code, uid, color) => dispatch('chooseStarterColor', [uid, color])

// No Mercy-only: resolving a pending Wild Color Roulette pick.
export const chooseRouletteColor = (code, uid, color) => dispatch('chooseRouletteColor', [uid, color])

export async function startNextRound() {
  return dispatch('startNextRound', [])
}

export async function returnToLobby() {
  return dispatch('returnToLobby', [])
}

export function roomsCollectionRef() {
  requireDb()
  return collection(db, 'rooms')
}
