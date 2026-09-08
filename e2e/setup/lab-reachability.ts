/**
 * Global setup: make the lab usable, or fail fast with an actionable message.
 *
 * Two jobs:
 *  1. Reachability — a forgotten `scripts/dev-lab.ps1` should produce one clear
 *     error instead of seven 45-second navigation timeouts.
 *  2. Authentication — `dsh web` prints `http://127.0.0.1:50599/?token=<token>`;
 *     a plain GET of `/` answers 401 until that URL has been visited once (it
 *     answers 303 + an HttpOnly `dsh-auth-*` cookie, valid 30 days). We redeem
 *     the token here and persist the cookie as a Playwright storage state so the
 *     specs can navigate normally.
 *
 * Token resolution order: `DSW_E2E_TOKEN`, then the `?token=` line of a lab log
 * (`DSW_E2E_LAB_LOG`, else the known `.tmp/*.stdout.log` candidates).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Mirrors the config default; kept in sync with `playwright.config.ts`. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:50599'
const PROBE_TIMEOUT_MS = 8_000

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATE_DIR = join(REPO_ROOT, 'e2e', 'artifacts')
export const STORAGE_STATE = join(STATE_DIR, '.auth-state.json')

const LOG_CANDIDATES = [
  '.tmp/e2e-lab.stdout.log',
  '.tmp/dev-lab-web.stdout.log',
  '.tmp/boot-smoke.stdout.log',
]

function hint(baseURL: string, extra = ''): string {
  return `[e2e] the lab instance at ${baseURL} is not usable.${extra}\n` +
    `      Start it first (isolated sandbox, DSH_HOME=C:\\Users\\Admin\\.dsh-lab, port 50599):\n` +
    `        pwsh -File scripts/dev-lab.ps1\n` +
    `      The real GUI on port 3080 is never a valid E2E target.\n` +
    `      Other lab: $env:DSW_E2E_BASE_URL = 'http://127.0.0.1:<port>'\n` +
    `      Token:    $env:DSW_E2E_TOKEN  = '<token from the dsh web URL>'`
}

/** Pull the `?token=` value out of a lab log line, if present. */
function tokenFromLogs(): string | undefined {
  const explicit = process.env.DSW_E2E_LAB_LOG
  const candidates = explicit ? [explicit] : LOG_CANDIDATES
  for (const candidate of candidates) {
    try {
      const text = readFileSync(join(REPO_ROOT, candidate), 'utf-8')
      const match = text.match(/https?:\/\/[^\s]*\?token=([A-Za-z0-9_-]+)/)
      if (match) return match[1]
    } catch {
      // Missing log is expected on a fresh checkout.
    }
  }
  return undefined
}

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/** Parse one `Set-Cookie` header into Playwright's storage-state shape. */
function parseCookie(header: string, hostname: string, secure: boolean): StoredCookie | undefined {
  const [pair, ...attrs] = header.split(';').map(part => part.trim())
  const eq = pair.indexOf('=')
  if (eq <= 0) return undefined
  const name = pair.slice(0, eq)
  const value = pair.slice(eq + 1)
  const attr = (key: string): string | undefined => {
    const found = attrs.find(part => part.toLowerCase().startsWith(`${key.toLowerCase()}=`))
    return found?.slice(key.length + 1)
  }
  const sameSiteRaw = (attr('SameSite') ?? 'Lax').toLowerCase()
  const expiresRaw = attr('Expires')
  const expires = expiresRaw ? Math.floor(new Date(expiresRaw).getTime() / 1000) : -1
  return {
    name,
    value,
    domain: attr('Domain') ?? hostname,
    path: attr('Path') ?? '/',
    expires: Number.isFinite(expires) ? expires : -1,
    httpOnly: attrs.some(part => part.toLowerCase() === 'httponly'),
    secure: secure || attrs.some(part => part.toLowerCase() === 'secure'),
    sameSite: sameSiteRaw === 'strict' ? 'Strict' : sameSiteRaw === 'none' ? 'None' : 'Lax',
  }
}

async function get(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: cookie ? { cookie } : undefined,
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  })
}

export default async function labSetup(): Promise<void> {
  const baseURL = process.env.DSW_E2E_BASE_URL ?? DEFAULT_BASE_URL
  const url = new URL(baseURL)
  const origin = `${url.protocol}//${url.host}`

  let probe: Response
  try {
    probe = await get(origin + '/')
  } catch (error) {
    throw new Error(hint(baseURL, `\n      probe failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  if (probe.status >= 500) {
    throw new Error(hint(baseURL, `\n      probe returned HTTP ${probe.status}`))
  }

  mkdirSync(STATE_DIR, { recursive: true })

  if (probe.status === 401) {
    const token = process.env.DSW_E2E_TOKEN ?? tokenFromLogs()
    if (!token) {
      throw new Error(hint(baseURL,
        `\n      the lab requires its URL token (HTTP 401) and none was found.\n` +
        `      Copy the token from the "dsh web: http://..." line, or point DSW_E2E_LAB_LOG at the lab log.`))
    }
    const redeem = await get(`${origin}/?token=${encodeURIComponent(token)}`)
    const setCookies = typeof redeem.headers.getSetCookie === 'function'
      ? redeem.headers.getSetCookie()
      : [redeem.headers.get('set-cookie')].filter((value): value is string => Boolean(value))
    const cookies = setCookies
      .map(header => parseCookie(header, url.hostname, url.protocol === 'https:'))
      .filter((cookie): cookie is StoredCookie => cookie !== undefined)
    if (cookies.length === 0) {
      throw new Error(hint(baseURL, `\n      redeeming the token returned HTTP ${redeem.status} without a session cookie.`))
    }
    const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
    const authed = await get(origin + '/', cookieHeader)
    if (authed.status !== 200) {
      throw new Error(hint(baseURL, `\n      the session cookie was set but / still answered HTTP ${authed.status}.`))
    }
    writeFileSync(STORAGE_STATE, `${JSON.stringify({ cookies, origins: [] }, null, 2)}\n`, 'utf-8')
    console.log(`[e2e] lab authenticated (token redeemed, ${cookies.length} cookie(s) stored)`)
    await authed.text().catch(() => undefined)
    return
  }

  if (probe.status !== 200) {
    throw new Error(hint(baseURL, `\n      probe returned HTTP ${probe.status}.`))
  }

  const contentType = probe.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(hint(baseURL,
      `\n      probe returned HTTP ${probe.status} with content-type ${JSON.stringify(contentType)}; ` +
      `expected the DSH web shell (text/html).`))
  }

  // No auth required: persist an empty state so the config's storageState path exists.
  writeFileSync(STORAGE_STATE, `${JSON.stringify({ cookies: [], origins: [] }, null, 2)}\n`, 'utf-8')
  await probe.text().catch(() => undefined)
}
