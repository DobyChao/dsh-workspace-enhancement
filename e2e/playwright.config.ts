/**
 * Playwright configuration for the dsh-workspace-enhancement E2E suite.
 *
 * Target: the ISOLATED lab instance (`scripts/dev-lab.ps1`, `DSH_HOME=.dsh-lab`,
 * port 50599). The real GUI instance on port 3080 is hard-blocked below: this
 * suite mutates lab state (machine registry entries, locale preference) and
 * must never touch the user's running harness.
 *
 * Evidence policy — deliberately NOT `trace: 'on'`:
 *   - `trace: 'on-first-retry'`: a full trace per test is heavy and official
 *     guidance discourages it; we only need one when a test actually retried
 *     (set `DSW_E2E_RETRIES=1` to allow a retry and therefore a trace).
 *   - `screenshot: 'only-on-failure'`: the happy path stores its own curated
 *     screenshots under `e2e/artifacts/screenshots/` (fixtures/dom.ts `shot`).
 *
 * Serial by design (`workers: 1`, `fullyParallel: false`): the lab persists the
 * locale preference in `settings.yaml` and shares one machine registry, so two
 * concurrently running specs would race on the language switch.
 *
 * Run from the repository root (script wiring is owned by the captain):
 *   pwsh -File scripts/dev-lab.ps1     # terminal 1: boot the lab
 *   npm run e2e                        # terminal 2
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './setup/lab-reachability'

/** Lab default; override with `DSW_E2E_BASE_URL` (e.g. a different lab port). */
const DEFAULT_BASE_URL = 'http://127.0.0.1:50599'
/** Port of the real, user-facing GUI instance — never a valid E2E target. */
const PRODUCTION_PORT = '3080'

/**
 * Refuse to run against the production GUI. Called while the config is loaded,
 * so a misconfigured run aborts before any browser is launched.
 * @param baseURL - resolved base URL (env override or the lab default).
 */
function assertLabTarget(baseURL: string): void {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error(`[e2e] DSW_E2E_BASE_URL is not a valid URL: ${JSON.stringify(baseURL)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`[e2e] DSW_E2E_BASE_URL must be http(s), got ${url.protocol}`)
  }
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  if (port === PRODUCTION_PORT) {
    throw new Error(
      `[e2e] refusing to run against ${baseURL}: port ${PRODUCTION_PORT} is the real GUI instance.\n` +
      `      This suite mutates machine/locale state and must only run against the isolated lab.\n` +
      `      Boot the lab (pwsh -File scripts/dev-lab.ps1) or point DSW_E2E_BASE_URL at it.`,
    )
  }
}

/** Parsed `DSW_E2E_RETRIES`; `trace: 'on-first-retry'` needs a retry to exist. */
function retriesFromEnv(): number {
  const raw = process.env.DSW_E2E_RETRIES
  if (raw === undefined || raw.trim() === '') return 0
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * Resolve a Chromium binary.
 *
 * `@playwright/test` pins an exact browser revision; this machine may already
 * carry a different one (`%LOCALAPPDATA%\ms-playwright\chromium-1234\...`) from
 * an older install or from `browser-use`. Rather than forcing a ~150 MB download
 * we reuse whatever is on disk, newest revision first. Set `DSW_E2E_CHROMIUM` to
 * override, or run `npx playwright install chromium` to match the pin exactly.
 */
function resolveChromium(): string | undefined {
  const explicit = process.env.DSW_E2E_CHROMIUM
  if (explicit !== undefined && explicit !== '') return explicit
  const root = process.env.LOCALAPPDATA
  if (!root) return undefined
  const cache = join(root, 'ms-playwright')
  if (!existsSync(cache)) return undefined
  const revisions = readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const revision of revisions) {
    const candidate = join(cache, revision, 'chrome-win64', 'chrome.exe')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const chromiumBinary = resolveChromium()

export const BASE_URL = process.env.DSW_E2E_BASE_URL ?? DEFAULT_BASE_URL
assertLabTarget(BASE_URL)

export default defineConfig({
  testDir: './specs',
  /** Separate from the HTML report folder, otherwise Playwright refuses to run. */
  outputDir: './artifacts/test-results',
  globalSetup: './setup/lab-reachability.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined && process.env.CI !== '',
  retries: retriesFromEnv(),
  /** Session creation (composer send + header mount) is the slowest path. */
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/html-report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    /**
     * Written by `globalSetup` (`setup/lab-reachability.ts`): `dsh web` serves
     * 401 until its `/?token=<token>` URL has been visited once, which sets an
     * HttpOnly session cookie. The setup redeems the token and persists it here.
     */
    storageState: STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    /**
     * `DSW_E2E_CHROMIUM` pins an exact browser binary. Without it we reuse the
     * newest chromium already present in `%LOCALAPPDATA%\ms-playwright` (see
     * `resolveChromium`), because the installed `@playwright/test` may expect a
     * different revision than the one on disk.
     */
    ...(chromiumBinary === undefined ? {} : { launchOptions: { executablePath: chromiumBinary } }),
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // After the device spread on purpose: the suite wants a wide desktop
        // viewport and a deterministic initial browser locale (zh-CN).
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
      },
    },
  ],
})
