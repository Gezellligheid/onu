import { DiscordSDK, patchUrlMappings } from '@discord/embedded-app-sdk'

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID

// The SDK constructor throws when the page isn't actually launched inside a
// Discord Activity iframe (no frame_id/instance_id query params) — that's
// also how we detect "embedded vs. plain web" for the same Vercel build.
let sdk = null
if (clientId) {
  try {
    sdk = new DiscordSDK(clientId)
  } catch {
    sdk = null
  }
}

export const discordSdk = sdk

export function isEmbedded() {
  return !!discordSdk
}

// Discord's Activity iframe is network-sandboxed to its own proxied origin;
// these rewrite our outbound Firebase calls to the matching URL Mappings
// configured in the Discord Developer Portal (Activities → URL Mappings),
// so they route through https://<client_id>.discordsays.com instead of
// being blocked. Prefixes here must match the portal exactly.
const URL_MAPPINGS = [
  { prefix: '/firestore', target: 'firestore.googleapis.com' },
  { prefix: '/firebase-auth', target: 'identitytoolkit.googleapis.com' },
  { prefix: '/firebase-token', target: 'securetoken.googleapis.com' },
  { prefix: '/fonts', target: 'fonts.googleapis.com' },
  { prefix: '/fonts-static', target: 'fonts.gstatic.com' },
]

let readyPromise = null

// Resolves once Discord's handshake completes (embedded), or immediately
// with null (plain web) — await this before touching Firebase or routing.
export function initDiscord() {
  if (!discordSdk) return Promise.resolve(null)
  if (!readyPromise) {
    patchUrlMappings(URL_MAPPINGS)
    readyPromise = discordSdk.ready().then(() => discordSdk)
  }
  return readyPromise
}
