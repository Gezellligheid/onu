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
import { HostSession } from './p2p/hostSession.js'
import { PeerSession } from './p2p/peerSession.js'
import { clearSignal } from './p2p/signaling.js'

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
  clearSignal(code.toUpperCase(), uid)
}

export function subscribeRoom(code, callback, onError) {
  requireDb()
  return onSnapshot(
    roomRef(code),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  )
}

// ---- P2P session lifecycle ----
// Lobby metadata (above) stays on Firestore; the live game itself flows
// entirely over a WebRTC data channel once a session is connected. See
// src/lib/p2p/{hostSession,peerSession}.js for the transport.

let session = null

export function connectSession({ code, uid, isHost, onGameState, onConnectionStatus }) {
  requireDb()
  disconnectSession()
  if (isHost) {
    // The live `game` never touches Firestore, but `status` is lobby
    // metadata (it gates joinRoom's "already started" check and lets a
    // fresh subscriber see the right phase before the P2P layer catches
    // up), so the host mirrors just that one field on each phase change —
    // not on every move, since status stays 'playing' for the whole round.
    let lastMirroredStatus = null
    session = new HostSession({
      code,
      hostUid: uid,
      onStateChange: (status, game) => {
        onGameState(status, game)
        if (status !== lastMirroredStatus) {
          lastMirroredStatus = status
          updateDoc(roomRef(code), { status }).catch(() => {})
        }
      },
    })
    onConnectionStatus('connected')
  } else {
    session = new PeerSession({ code, uid, onStateChange: onGameState, onConnectionStatus })
  }
}

export function disconnectSession() {
  if (session) session.destroy()
  session = null
}

export function syncSessionPeers(players) {
  if (session instanceof HostSession) session.syncPeers(players)
}

export function syncSessionConfig(lobbyDoc) {
  if (session instanceof HostSession) session.updateConfig(lobbyDoc)
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
