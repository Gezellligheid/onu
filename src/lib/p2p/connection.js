export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]

export const CONNECT_TIMEOUT_MS = 15000

export function createPeerConnection() {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS })
}
