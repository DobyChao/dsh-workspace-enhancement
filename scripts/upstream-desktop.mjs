#!/usr/bin/env node
/**
 * Desktop composition watch (UPSTREAM-11): the three existing sentinels
 * (tag-watch, scope-watch, weekly drift) are ALL blind to the desktop app,
 * because `@deepseek-ai/dsh-desktop` / `-desktop-host` are private packages
 * that never touch npm. The desktop monorepo (`deepseek-ai/deepseek-harness`)
 * is the only authoritative source, and the desktop profile is initialized
 * from `PROFILE_TEMPLATES.web` (`apps/desktop/src/project-manager.ts`) — the
 * day that template stops being web-shaped is the day our plugin's four
 * coupling surfaces silently stop applying (survey: docs/notes/upstream11-desktop-survey.md).
 *
 * So this watch mirrors tag-watch's shape (baseline + diff + issue): fetch the
 * three composition-defining files from the monorepo default branch, hash
 * them, and ring when ANY of them moves.
 *
 * Baseline: `scripts/upstream-desktop-baseline.json`; acknowledging a movement
 * = `node scripts/upstream-desktop.mjs --write-baseline` and commit. Pure
 * logic is exported for `test/upstream-desktop.test.ts`; the CLI only fetches,
 * diffs, reports.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
export const DESKTOP_BASELINE_PATH = join(root, 'scripts', 'upstream-desktop-baseline.json')

/** Monorepo files that define the desktop composition (path → meaning). */
export const DESKTOP_FILES = {
  'apps/desktop/package.json':
    'the desktop app version moved — desktop ships same-day with dsh; confirm the pairing and whether port/profile defaults changed',
  'apps/desktop/src/project-manager.ts':
    'the profile template changed — EARLIEST signal that the desktop profile stops being web-shaped (the core UPSTREAM-11 risk); re-run the desktop survey',
  'apps/desktop/src/core-package-set.ts':
    'the desktop runtime core-package pins changed — the direct mechanism file for "desktop composition vs our pinned web family" (pnpm overrides surface)',
  'apps/desktop-host/src/index.ts':
    'the desktop host shell wiring changed — re-check the /api/dsw channel and client-slot assumptions (survey §2)',
}

/**
 * Semantic invariant of `project-manager.ts` (R51 review): the desktop profile
 * must keep sourcing its bundles from the WEB template. A fingerprint change
 * alone could be cosmetic; this flag going false means 方案 1's premise broke.
 */
export const WEB_TEMPLATE_INVARIANT = /PROFILE_TEMPLATES\.web/

/** Raw source of the monorepo default branch (verified reachable 2026-10-10). */
const RAW_BASE = 'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master'

/** Read the desktop app version out of `apps/desktop/package.json` text. */
export function extractDesktopVersion(packageJsonText) {
  try {
    const parsed = JSON.parse(packageJsonText)
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

/** The observed fingerprint of one file: length + sha256 (+ version when readable). */
export function fingerprintOf(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** The observed fingerprint fields that participate in the diff. */
const FIELDS = ['sha256', 'bytes', 'version', 'webTemplate']

/**
 * Diff observed fingerprints against the baseline. Both sides share the shape
 * `{ [path]: { sha256, bytes, version?, webTemplate? } }`; a path missing from
 * the baseline counts as an addition, never a crash.
 * @returns {{ changes: Array<{ path: string, field: string, from: string, to: string }>, silent: boolean }}
 */
export function diffDesktop(baseline, observed) {
  const changes = []
  for (const path of Object.keys(DESKTOP_FILES)) {
    const to = observed?.[path]
    if (to === undefined) continue
    const from = baseline?.[path] ?? {}
    for (const field of FIELDS) {
      const toValue = to[field]
      if (toValue === undefined) continue
      const fromValue = from[field] ?? '(none)'
      if (fromValue !== toValue) changes.push({ path, field, from: String(fromValue), to: String(toValue) })
    }
  }
  return { changes, silent: changes.length === 0 }
}

/** Human-readable report of the movements (empty string when silent). */
export function renderReport({ changes }) {
  if (changes.length === 0) return ''
  const forked = changes.some(change => change.field === 'webTemplate' && change.to === 'false')
  const touched = [...new Set(changes.map(change => change.path))]
  const lines = [
    'The desktop composition files in `deepseek-ai/deepseek-harness` moved relative to `scripts/upstream-desktop-baseline.json`.',
    ...(forked ? ['', '**⚠ COMPOSITION FORK: `project-manager.ts` no longer sources the desktop profile from `PROFILE_TEMPLATES.web` — the 方案 1 premise (zero-code desktop compatibility) is BROKEN. Re-run the desktop survey before anything else.**'] : []),
    '',
    '| file | field | was | now |',
    '|---|---|---|---|',
    ...changes.map(change => `| \`${change.path}\` | ${change.field} | ${change.from} | ${change.to} |`),
    '',
    'What it means:',
    '',
    ...touched.map(path => `- \`${path}\` → ${DESKTOP_FILES[path] ?? 're-check docs/notes/upstream11-desktop-survey.md'}`),
    '',
    'The npm-channel sentinels cannot see the desktop (private packages, no dist-tags),',
    'so this file-diff watch is the ONLY coverage for the desktop composition (UPSTREAM-11).',
    '',
    'Acknowledge by acting on the meanings above, then run',
    '`node scripts/upstream-desktop.mjs --write-baseline` and commit the regenerated baseline.',
  ]
  return lines.join('\n')
}

/** Fetch one monorepo file's text (throws loudly — a failed probe must not read as "silent"). */
async function fetchFile(path) {
  const response = await fetch(`${RAW_BASE}/${path}`, { redirect: 'follow' })
  if (!response.ok) throw new Error(`fetch ${path} failed: HTTP ${response.status}`)
  return await response.text()
}

/** Fetch every watched file's fingerprint. */
export async function observeDesktop() {
  const observed = {}
  for (const path of Object.keys(DESKTOP_FILES)) {
    const text = await fetchFile(path)
    observed[path] = {
      sha256: fingerprintOf(text),
      bytes: Buffer.byteLength(text, 'utf8'),
      ...(path === 'apps/desktop/package.json' && extractDesktopVersion(text) !== undefined
        ? { version: extractDesktopVersion(text) }
        : {}),
      ...(path === 'apps/desktop/src/project-manager.ts'
        ? { webTemplate: WEB_TEMPLATE_INVARIANT.test(text) }
        : {}),
    }
  }
  return observed
}

function writeGithubOutput(name, value) {
  const target = process.env.GITHUB_OUTPUT
  if (target === undefined || target === '') return
  const delimiter = `dsw-desktop-${name}`
  writeFileSync(target, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { flag: 'a' })
}

async function main() {
  const writeBaseline = process.argv.includes('--write-baseline')
  const observed = await observeDesktop()
  if (writeBaseline) {
    const baseline = {
      $comment: 'Acknowledged fingerprints of the desktop composition files (the npm-channel sentinels '
        + 'cannot see the private desktop packages — compatibility.md §7). The desktop watch (upstream.yml, '
        + 'weekly) diffs the live monorepo against this file and opens an issue on movement; regenerate with '
        + '`node scripts/upstream-desktop.mjs --write-baseline` to acknowledge.',
      recordedAt: new Date().toISOString().slice(0, 10),
      files: observed,
    }
    writeFileSync(DESKTOP_BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.error(`wrote ${DESKTOP_BASELINE_PATH}`)
    return
  }
  const baseline = JSON.parse(readFileSync(DESKTOP_BASELINE_PATH, 'utf8'))
  const diff = diffDesktop(baseline.files, observed)
  const report = renderReport(diff)
  if (diff.silent) {
    console.log('desktop watch: no composition movement (baseline matches the monorepo)')
    writeGithubOutput('signal', '')
  } else {
    console.log(report)
    const reportDir = join(root, '.tmp')
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, 'upstream-desktop-report.md')
    writeFileSync(reportPath, `${report}\n`)
    writeGithubOutput('signal', 'changed')
    writeGithubOutput('reportPath', reportPath)
    console.error(`report written: ${reportPath}`)
  }
}

// CLI-only entry (tests import the pure functions above without side effects).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
