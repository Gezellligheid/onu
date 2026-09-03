// Pure Firestore helpers for one-time WebRTC handshake signaling. No
// knowledge of RTCPeerConnection or the game engine lives here — just
// reading/writing rooms/{code}/signals/{peerUid} docs.
import { doc, onSnapshot, setDoc, deleteDoc, arrayUnion } from 'firebase/firestore'
import { db } from '../../firebase.js'

function signalRef(code, peerUid) {
  return doc(db, 'rooms', code, 'signals', peerUid)
}

export function watchSignal(code, peerUid, onData) {
  return onSnapshot(signalRef(code, peerUid), (snap) => onData(snap.exists() ? snap.data() : null))
}

export async function publishOffer(code, peerUid, offer) {
  await setDoc(signalRef(code, peerUid), { offer: { type: offer.type, sdp: offer.sdp } }, { merge: true })
}

export async function publishAnswer(code, peerUid, answer) {
  await setDoc(signalRef(code, peerUid), { answer: { type: answer.type, sdp: answer.sdp } }, { merge: true })
}

export async function pushHostCandidates(code, peerUid, candidates) {
  if (!candidates.length) return
  await setDoc(signalRef(code, peerUid), { hostCandidates: arrayUnion(...candidates) }, { merge: true })
}

export async function pushPeerCandidates(code, peerUid, candidates) {
  if (!candidates.length) return
  await setDoc(signalRef(code, peerUid), { peerCandidates: arrayUnion(...candidates) }, { merge: true })
}

export async function clearSignal(code, peerUid) {
  try {
    await deleteDoc(signalRef(code, peerUid))
  } catch {
    // Best-effort cleanup — fine if it's already gone.
  }
}
