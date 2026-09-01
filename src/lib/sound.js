// Lightweight synthesized SFX engine (Web Audio API). No external audio
// files are downloaded/bundled — every effect is generated on the fly,
// which sidesteps licensing/attribution concerns and keeps the app small
// and fully offline-capable.

let ctx = null
let muted = false

const MUTE_KEY = 'uno.muted'
try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {
  muted = false
}

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

/** Must be called from within a user-gesture handler at least once. */
export function unlockAudio() {
  getCtx()
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* ignore */
  }
}

function tone(c, { freq, start = 0, duration = 0.12, type = 'sine', gain = 0.18, glideTo = null }) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, c.currentTime + start)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + start + duration)
  g.gain.setValueAtTime(0, c.currentTime + start)
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(c.currentTime + start)
  osc.stop(c.currentTime + start + duration + 0.02)
}

function noiseBurst(c, { start = 0, duration = 0.1, gain = 0.12, filterFreq = 2000 }) {
  const bufferSize = Math.floor(c.sampleRate * duration)
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  }
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = filterFreq
  const g = c.createGain()
  g.gain.setValueAtTime(gain, c.currentTime + start)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration)
  src.connect(filter)
  filter.connect(g)
  g.connect(c.destination)
  src.start(c.currentTime + start)
}

function run(fn) {
  if (muted) return
  const c = getCtx()
  if (!c) return
  try {
    fn(c)
  } catch {
    /* audio is best-effort */
  }
}

// Recorded clips, layered in alongside their synthesized counterparts below.
// One is picked at random from each list per occurrence.
const UNO_CALL_CLIPS = ['/sounds/uno-calls/uno1.m4a', '/sounds/uno-calls/uno2.m4a', '/sounds/uno-calls/uno3.m4a']
const BLOCKED_CLIPS = ['/sounds/blocked/blocked1.m4a', '/sounds/blocked/blocked2.m4a', '/sounds/blocked/blocked3.m4a']
const ROTATE_CLIPS = ['/sounds/rotate/rotate1.m4a', '/sounds/rotate/rotate2.m4a']

function playRandomClip(clips, volume = 0.85) {
  if (muted) return
  try {
    const src = clips[Math.floor(Math.random() * clips.length)]
    const audio = new Audio(src)
    audio.volume = volume
    const p = audio.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* audio is best-effort */
  }
}

export const sfx = {
  cardPlay() {
    run((c) => {
      noiseBurst(c, { duration: 0.08, gain: 0.14, filterFreq: 3000 })
      tone(c, { freq: 520, duration: 0.09, type: 'triangle', gain: 0.1 })
    })
  },
  cardDraw(count = 1) {
    run((c) => {
      const n = Math.min(count, 6)
      for (let i = 0; i < n; i += 1) {
        noiseBurst(c, { start: i * 0.09, duration: 0.07, gain: 0.1, filterFreq: 1800 })
      }
    })
  },
  invalid() {
    run((c) => {
      tone(c, { freq: 180, duration: 0.16, type: 'sawtooth', gain: 0.12, glideTo: 90 })
    })
  },
  turnYours() {
    run((c) => {
      tone(c, { freq: 660, duration: 0.1, type: 'sine', gain: 0.14 })
      tone(c, { freq: 880, start: 0.1, duration: 0.14, type: 'sine', gain: 0.14 })
    })
  },
  unoCall() {
    playRandomClip(UNO_CALL_CLIPS)
    run((c) => {
      tone(c, { freq: 700, duration: 0.08, type: 'square', gain: 0.1 })
      tone(c, { freq: 1000, start: 0.08, duration: 0.12, type: 'square', gain: 0.1 })
    })
  },
  caught() {
    run((c) => {
      tone(c, { freq: 400, duration: 0.14, type: 'sawtooth', gain: 0.13, glideTo: 140 })
      noiseBurst(c, { start: 0.05, duration: 0.15, gain: 0.1 })
    })
  },
  skip() {
    playRandomClip(BLOCKED_CLIPS)
    run((c) => {
      tone(c, { freq: 300, duration: 0.1, type: 'square', gain: 0.08, glideTo: 150 })
    })
  },
  reverse() {
    playRandomClip(ROTATE_CLIPS)
    run((c) => {
      tone(c, { freq: 440, duration: 0.08, type: 'sine', gain: 0.08 })
      tone(c, { freq: 330, start: 0.07, duration: 0.08, type: 'sine', gain: 0.08 })
    })
  },
  stack() {
    run((c) => {
      tone(c, { freq: 520, duration: 0.07, type: 'square', gain: 0.12 })
      tone(c, { freq: 650, start: 0.06, duration: 0.09, type: 'square', gain: 0.12 })
    })
  },
  wild() {
    run((c) => {
      ;[523, 659, 784, 988].forEach((f, i) => tone(c, { freq: f, start: i * 0.05, duration: 0.1, type: 'sine', gain: 0.09 }))
    })
  },
  roundWin() {
    run((c) => {
      ;[523, 659, 784, 1046].forEach((f, i) => tone(c, { freq: f, start: i * 0.09, duration: 0.2, type: 'triangle', gain: 0.15 }))
    })
  },
  gameWin() {
    run((c) => {
      ;[523, 659, 784, 1046, 1318].forEach((f, i) =>
        tone(c, { freq: f, start: i * 0.11, duration: 0.28, type: 'triangle', gain: 0.16 }),
      )
    })
  },
  autoPlay() {
    run((c) => {
      tone(c, { freq: 260, duration: 0.09, type: 'square', gain: 0.09 })
      tone(c, { freq: 220, start: 0.09, duration: 0.09, type: 'square', gain: 0.09 })
    })
  },
  click() {
    run((c) => {
      tone(c, { freq: 800, duration: 0.04, type: 'square', gain: 0.06 })
    })
  },
}
