#!/usr/bin/env node
/**
 * Dist-tag watch (INFRA-20): the 2026-09-28 `latest` flip to 0.1.7-rc.2 was
 * noticed by the OWNER'S eye, not by any sentinel — the weekly drift only
 * reinstalls a family when it runs, and scope-watch diffs package COMPOSITION,
 * not tags. Tag movement is the cheapest upstream signal there is (seconds,
 * zero deps), so it gets a DAILY probe:
 *
 *   - `latest` moving = NEW INSTALLS change host family → check the peer-pin
 *     policy (the UPSTREAM-5 deferred "raise when latest moves" rule);
 *   - `next` moving = the drift family moves → expect the weekly drift to ring
 *     next Monday; a manual dispatch closes the gap today;
 *   - `alpha` moving = early warning (ADR-0026 timelines).
 *
 * Family signal is the HOST package (`@deepseek-ai/dsh`) only: the seam
 * packages' own `latest` tags sit frozen at 0.0.1-rc.1 and mean nothing
 * (docs/compatibility.md §3.1).
 *
 * Baseline: `scripts/upstream-tags-baseline.json`; acknowledging a movement =
 * `node scripts/upstream-tags.mjs --write-baseline` and commit. The registry
 * is read through the npm CLI (ADR-0026 §6). Pure logic is exported for
 * `test/upstream-tags.test.ts`; the CLI only fetches, diffs, reports.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
export const TAG_BASELINE_PATH = join(root, 'scripts', 'upstream-tags-baseline.json')

/** The host package whose dist-tags are the family signal (seam tags are noise). */
export const TAG_PACKAGES = ['@deepseek-ai/dsh']

/** Channels watched (same vocabulary as the drift sentinel). */
export const TAG_CHANNELS = ['latest', 'next', 'alpha']

/** What a movement on each channel MEANS (rendered into the issue body). */
export const CHANNEL_MEANING = {
  latest: 'new installs change host family — check the peer-pin policy (compatibility.md §1: raise peers when latest moves onto a new line)',
  next: 'the drift family moved — run the drift workflow manually instead of waiting for the weekly slot',
  alpha: 'early warning — alpha content gets promoted to rc eventually (ADR-0026)',
}

/**
 * Diff observed tags against the baseline. Both sides share the shape
 * `{ [pkg]: { [channel]: version } }`; a channel missing from the baseline
 * counts as an addition, never a crash.
 * @returns {{ changes: Array<{ package: string, channel: string, from: string, to: string }>, silent: boolean }}
 */
export function diffTags(baseline, observed) {
  const changes = []
  for (const pkg of TAG_PACKAGES) {
    for (const channel of TAG_CHANNELS) {
      const to = observed?.[pkg]?.[channel]
      if (to === undefined) continue
      const from = baseline?.[pkg]?.[channel] ?? '(none)'
      if (from !== to) changes.push({ package: pkg, channel, from, to })
    }
  }
  return { changes, silent: changes.length === 0 }
}

/** Human-readable report of the movements (empty string when silent). */
export function renderReport({ changes }) {
  if (changes.length === 0) return ''
  const lines = [
    'The `@deepseek-ai/dsh` dist-tags moved relative to `scripts/upstream-tags-baseline.json`.',
    '',
    '| package | channel | was | now |',
    '|---|---|---|---|',
    ...changes.map(change => `| ${change.package} | ${change.channel} | ${change.from} | ${change.to} |`),
    '',
    'What it means:',
    '',
    ...changes.map(change => `- \`${change.channel}\` → ${CHANNEL_MEANING[change.channel] ?? 're-check docs/compatibility.md'}`),
    '',
    'Acknowledge by acting on the meanings above (peer pin / manual drift dispatch), then run',
    '`node scripts/upstream-tags.mjs --write-baseline` and commit the regenerated baseline.',
  ]
  return lines.join('\n')
}

/** Read the dist-tags of one package through the npm CLI (proxy-aware). */
function queryTags(pkg) {
  // CI runners and normal local shells only — never the DSH file sandbox
  // (AGENTS.md §4). `shell` is required for npm.cmd on Windows.
  const plain = spawnSync('npm', ['view', pkg, 'dist-tags', '--json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, shell: process.platform === 'win32' })
  if (plain.error !== undefined || plain.status !== 0 || plain.stdout.trim() === '') {
    const why = plain.error?.message ?? String(plain.stderr ?? '').trim() ?? 'no output'
    throw new Error(`npm view ${pkg} dist-tags failed: ${why}`)
  }
  return JSON.parse(plain.stdout)
}

/** Fetch every observed channel cell (host packages × channels). */
export function observeTags() {
  const observed = {}
  for (const pkg of TAG_PACKAGES) {
    const tags = queryTags(pkg)
    observed[pkg] = {}
    for (const channel of TAG_CHANNELS) {
      const version = tags[channel]
      if (typeof version === 'string') observed[pkg][channel] = version
    }
  }
  return observed
}

function writeGithubOutput(name, value) {
  const target = process.env.GITHUB_OUTPUT
  if (target === undefined || target === '') return
  const delimiter = `dsw-tags-${name}`
  writeFileSync(target, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { flag: 'a' })
}

function main() {
  const writeBaseline = process.argv.includes('--write-baseline')
  const observed = observeTags()
  if (writeBaseline) {
    const baseline = {
      $comment: 'Acknowledged dist-tags of the host package (the family signal; seam packages\' own latest '
        + 'tags are frozen noise — compatibility.md §3.1). The tag watch (upstream.yml, daily) diffs live '
        + 'registry data against this file and opens an issue on movement; regenerate with '
        + '`node scripts/upstream-tags.mjs --write-baseline` to acknowledge.',
      recordedAt: new Date().toISOString().slice(0, 10),
      tags: observed,
    }
    writeFileSync(TAG_BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.error(`wrote ${TAG_BASELINE_PATH}`)
    return
  }
  const baseline = JSON.parse(readFileSync(TAG_BASELINE_PATH, 'utf8'))
  const diff = diffTags(baseline.tags, observed)
  const report = renderReport(diff)
  if (diff.silent) {
    console.log('tag watch: no dist-tag movement (baseline matches the registry)')
    writeGithubOutput('signal', '')
  } else {
    console.log(report)
    const reportDir = join(root, '.tmp')
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, 'upstream-tags-report.md')
    writeFileSync(reportPath, `${report}\n`)
    writeGithubOutput('signal', 'changed')
    writeGithubOutput('reportPath', reportPath)
    console.error(`report written: ${reportPath}`)
  }
}

// CLI-only entry (tests import the pure functions above without side effects).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
