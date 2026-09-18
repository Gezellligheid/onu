// Runs as a Firebase Hosting predeploy step (see firebase.json). The
// renderRoom Cloud Function needs the *built* index.html — hashed asset
// paths and all — as its starting template, but Firebase only uploads the
// functions/ directory on deploy, so it can't reach into dist/ at runtime.
// This copies the freshly built file in ahead of time.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'dist', 'index.html')
const destDir = path.join(root, 'functions')
const dest = path.join(destDir, 'index-template.html')

if (!existsSync(src)) {
  console.error(`${src} not found — run \`npm run build\` first.`)
  process.exit(1)
}
if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log(`Copied ${src} -> ${dest}`)
