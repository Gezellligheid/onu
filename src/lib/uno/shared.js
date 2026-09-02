// Mode-agnostic helpers shared by every rules engine (classic, no-mercy, ...).
// Deliberately minimal — anything with real rules divergence lives in its
// own engine module rather than being forced through a shared abstraction.

export function shuffle(cards) {
  const arr = cards.slice()
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function clone(state) {
  return JSON.parse(JSON.stringify(state))
}
