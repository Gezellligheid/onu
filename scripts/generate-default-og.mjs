// One-off generator for the site-wide default OG/link-preview image
// (public/og-image.png) — used for the homepage and as a fallback wherever
// a room-specific image can't be generated. Re-run this manually whenever
// the branding in og-image-svg.mjs changes:
//
//   node scripts/generate-default-og.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import { buildOgImageSvg } from './og-image-svg.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dest = path.join(root, 'public', 'og-image.png')

const svg = buildOgImageSvg({})
const png = await sharp(Buffer.from(svg)).png().toBuffer()
writeFileSync(dest, png)
console.log(`Wrote ${dest} (${png.length} bytes)`)
