import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const SRC_DIR = 'nomercycards'
const OUT_DIR = 'public/cards/no-mercy'

// Grid geometry measured directly from the sheet images (904x639, 5 cols x 2 rows).
const COL_X = [26, 196, 366, 537, 707, 877]
const ROW_Y = [55, 319, 584]
const INSET = 4 // shave a few px off each edge so the crop doesn't include the guide line itself

function cellRect(row, col) {
  const left = COL_X[col - 1] + INSET
  const right = COL_X[col] - INSET
  const top = ROW_Y[row - 1] + INSET
  const bottom = ROW_Y[row] - INSET
  return { left, top, width: right - left, height: bottom - top }
}

function pageFile(n) {
  const files = fs.readdirSync(SRC_DIR)
  const match = files.find((f) => f.startsWith(`${n}-`))
  if (!match) throw new Error(`No source page found for page ${n}`)
  return path.join(SRC_DIR, match)
}

// One representative (page, row, col) per unique card design — first
// occurrence of each design across the 17-page sheet.
const CARDS = [
  // yellow numbers
  ['yellow-0', 1, 2, 1], ['yellow-1', 1, 2, 3], ['yellow-2', 1, 2, 5],
  ['yellow-3', 2, 1, 2], ['yellow-4', 2, 1, 4], ['yellow-5', 2, 2, 1],
  ['yellow-6', 2, 2, 3], ['yellow-7', 2, 2, 5], ['yellow-8', 3, 1, 2],
  ['yellow-9', 3, 1, 4],
  // blue numbers
  ['blue-0', 5, 1, 2], ['blue-1', 5, 1, 4], ['blue-2', 5, 2, 1],
  ['blue-3', 5, 2, 3], ['blue-4', 5, 2, 5], ['blue-5', 6, 1, 2],
  ['blue-6', 6, 1, 4], ['blue-7', 6, 2, 1], ['blue-8', 6, 2, 3],
  ['blue-9', 6, 2, 5],
  // green numbers
  ['green-0', 8, 2, 3], ['green-1', 8, 2, 5], ['green-2', 9, 1, 2],
  ['green-3', 9, 1, 4], ['green-4', 9, 2, 1], ['green-5', 9, 2, 3],
  ['green-6', 9, 2, 5], ['green-7', 10, 1, 2], ['green-8', 10, 1, 4],
  ['green-9', 10, 2, 1],
  // red numbers
  ['red-0', 12, 1, 4], ['red-1', 12, 2, 1], ['red-2', 12, 2, 3],
  ['red-3', 12, 2, 5], ['red-4', 13, 1, 2], ['red-5', 13, 1, 4],
  ['red-6', 13, 2, 1], ['red-7', 13, 2, 3], ['red-8', 13, 2, 5],
  ['red-9', 14, 1, 2],
  // colored action cards
  ['yellow-draw2', 1, 1, 1], ['yellow-draw4', 1, 1, 4],
  ['yellow-skip', 3, 2, 1], ['yellow-skipEveryone', 3, 2, 4],
  ['yellow-reverse', 4, 1, 1], ['yellow-discardAll', 4, 1, 4],
  ['blue-draw2', 4, 2, 2], ['blue-draw4', 4, 2, 5],
  ['blue-skip', 7, 1, 2], ['blue-skipEveryone', 7, 1, 5],
  ['blue-reverse', 7, 2, 2], ['blue-discardAll', 7, 2, 5],
  ['green-draw2', 8, 1, 3], ['green-draw4', 8, 2, 1],
  ['green-skip', 10, 2, 3], ['green-skipEveryone', 11, 1, 1],
  ['green-reverse', 11, 1, 3], ['green-discardAll', 11, 2, 1],
  ['red-draw2', 11, 2, 4], ['red-draw4', 12, 1, 2],
  ['red-skip', 14, 1, 4], ['red-skipEveryone', 14, 2, 2],
  ['red-reverse', 14, 2, 4], ['red-discardAll', 15, 1, 2],
  // wilds
  ['black-wildDraw10', 15, 1, 5], ['black-wildReverseDraw4', 15, 2, 4],
  ['black-wildColorRoulette', 16, 2, 2], ['black-wildDraw6', 17, 1, 5],
]

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, page, row, col] of CARDS) {
    const src = pageFile(page)
    const rect = cellRect(row, col)
    const out = path.join(OUT_DIR, `${name}.jpg`)
    await sharp(src).extract(rect).jpeg({ quality: 92 }).toFile(out)
    console.log('wrote', out)
  }
  console.log(`Done: ${CARDS.length} card faces.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
