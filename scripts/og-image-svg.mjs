// Builds the OG/link-preview image as an SVG string, rasterized to PNG by
// sharp — used both by scripts/generate-default-og.mjs (the static
// homepage image, committed to public/) and by functions/og-image.js (the
// per-room image, rendered live with that room's invite code baked in).
// Kept as two copies rather than one shared import: Firebase only uploads
// the functions/ directory on deploy, so a cross-directory import would
// break in production. Keep both in sync by hand if you touch this file.
const BRAND = { red: '#ED1C24', yellow: '#FFD500', green: '#3AA655', blue: '#0072CE' }
const W = 1200
const H = 630

export function buildOgImageSvg({ code = '', subtitle = '' } = {}) {
  const hasCode = !!code
  const codeText = hasCode ? escapeXml(code.split('').join(' ')) : ''
  const subtitleText = escapeXml(subtitle)

  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0f172a" />
      <stop offset="1" stop-color="#1e293b" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />

  <!-- UNO-deck-style color bars along each edge -->
  <rect x="0" y="0" width="${W}" height="12" fill="${BRAND.red}" />
  <rect x="0" y="${H - 12}" width="${W}" height="12" fill="${BRAND.blue}" />
  <rect x="0" y="0" width="12" height="${H}" fill="${BRAND.yellow}" />
  <rect x="${W - 12}" y="0" width="12" height="${H}" fill="${BRAND.green}" />

  <!-- logo badge, mirrors HomeView's rotated red "0" mark -->
  <g transform="translate(104, 104) rotate(-10)">
    <rect x="-48" y="-48" width="96" height="96" rx="22" fill="${BRAND.red}" />
    <text x="1" y="26" font-family="Arial, sans-serif" font-size="64" font-weight="800" fill="white" text-anchor="middle">0</text>
  </g>
  <text x="184" y="128" font-family="Arial, sans-serif" font-size="48" font-weight="800" fill="white">UNO Online</text>

  ${
    hasCode
      ? `
  <text x="96" y="336" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="#94a3b8" letter-spacing="6">INVITE CODE</text>
  <text x="94" y="450" font-family="Arial, sans-serif" font-size="140" font-weight="800" fill="${BRAND.yellow}" letter-spacing="14">${codeText}</text>
  <text x="96" y="504" font-family="Arial, sans-serif" font-size="30" font-weight="600" fill="#cbd5e1">${subtitleText} — tap to join the table</text>
  `
      : `
  <text x="96" y="420" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="#cbd5e1">Real-time multiplayer UNO — create a room,</text>
  <text x="96" y="465" font-family="Arial, sans-serif" font-size="34" font-weight="600" fill="#cbd5e1">share the code, and play with friends.</text>
  `
  }
</svg>`
}

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
}
