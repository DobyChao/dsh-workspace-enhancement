#!/usr/bin/env node
/**
 * Scope watch (UPSTREAM-7): the drift channels in `upstream.yml` only reinstall
 * OUR seam family list, so a green channel proves nothing about packages we do
 * not depend on. The 0.1.6 line shipped a whole official SSH provider family
 * that way — invisible to every gate until someone ran `npm view` by hand
 * (ADR-0026 §5). This script turns "upstream added a capability package" into
 * a signal that rings:
 *
 *   1. composition drift — the `@deepseek-ai/*` dependency set of the host
 *      packages (`dsh`, `dsh-web-app`) per dist-tag is diffed against the
 *      committed baseline (`scripts/upstream-baseline.json`). Any addition or
 *      removal opens/updates the scope-watch issue; acknowledging means
 *      regenerating the baseline and committing it.
 *   2. SSH adoption — the four official SSH runtime packages entering any
 *      host composition is the tracked UPSTREAM-6 reevaluation trigger and is
 *      called out in the report even though it is just a special case of (1).
 *
 * The registry is read through the npm CLI (ADR-0026 §6: `npm view` honors the
 * machine proxy where plain HTTPS clients do not). Pure logic is exported for
 * `test/upstream-watch.test.ts`; the CLI only fetches, diffs, reports.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
export const BASELINE_PATH = join(root, 'scripts', 'upstream-baseline.json')

/** Host packages whose composition defines the default deployment. */
export const HOST_PACKAGES = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-web-app']

/** Dist-tags probed per host package (the same channels the drift sentinel watches). */
export const HOST_TAGS = ['latest', 'next', 'alpha']

/** The official SSH runtime family (ADR-0026): adoption is the UPSTREAM-6 trigger. */
export const SSH_PACKAGES = [
  '@deepseek-ai/dsh-ssh',
  '@deepseek-ai/dsh-fs-ssh',
  '@deepseek-ai/dsh-subprocess-ssh',
  '@deepseek-ai/dsh-sandbox-ssh',
]

/** Manifest blocks that count as "part of the composition". */
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

/** Sorted `@deepseek-ai/*` names a manifest pulls in through any dep block. */
export function deepDepsOf(manifest) {
  const names = new Set()
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest?.[field] ?? {})) {
      if (name.startsWith('@deepseek-ai/')) names.add(name)
    }
  }
  return [...names].sort()
}

/** One observed composition cell: the version a tag resolves to and its dep set. */
export function compositionCell(version, deps) {
  return { version, deps: [...deps].sort() }
}

/**
 * Diff observed registry data against the baseline.
 * Both sides share the shape `{ [pkg]: { [tag]: { version, deps } } }`; the
 * baseline may legitimately lack a cell (new tag/package published) — that is
 * reported as an addition, never a crash.
 * @returns {{ changes: Array<{ package: string, tag: string, kind: 'added'|'removed', deps: string[] }>,
 *             sshAdopted: Array<{ package: string, tag: string, version: string, deps: string[] }>,
 *             sshBaseline: Array<{ package: string, tag: string, version: string, deps: string[] }> }}
 */
export function diffBaseline(baseline, observed) {
  const changes = []
  const sshAdopted = []
  const sshBaseline = []
  for (const pkg of HOST_PACKAGES) {
    for (const tag of HOST_TAGS) {
      const now = observed?.[pkg]?.[tag]
      const was = baseline?.[pkg]?.[tag]
      if (now === undefined) continue
      const nowDeps = [...now.deps].sort()
      const wasDeps = was === undefined ? [] : [...was.deps].sort()
      const added = nowDeps.filter(name => !wasDeps.includes(name))
      const removed = wasDeps.filter(name => !nowDeps.includes(name))
      if (added.length > 0) changes.push({ package: pkg, tag, kind: 'added', deps: added })
      if (removed.length > 0) changes.push({ package: pkg, tag, kind: 'removed', deps: removed })
      const ssh = nowDeps.filter(name => SSH_PACKAGES.includes(name))
      if (ssh.length > 0) {
        sshAdopted.push({ package: pkg, tag, version: now.version, deps: ssh })
        if (was === undefined || was.deps.filter(name => SSH_PACKAGES.includes(name)).length === 0) {
          sshBaseline.push({ package: pkg, tag, version: now.version, deps: ssh })
        }
      }
    }
  }
  return { changes, sshAdopted, sshBaseline }
}

/** Human-readable report of one diff (empty string when nothing rang). */
export function renderReport(diff) {
  if (diff.changes.length === 0 && diff.sshBaseline.length === 0) return ''
  const lines = ['The `@deepseek-ai` host composition moved relative to `scripts/upstream-baseline.json`.', '']
  for (const change of diff.changes) {
    lines.push(`- ${change.package}@${change.tag} ${change.kind === 'added' ? 'now depends on' : 'no longer depends on'}:`)
    for (const dep of change.deps) lines.push(`  - ${dep}`)
  }
  if (diff.sshBaseline.length > 0) {
    lines.push('')
    lines.push('**Official SSH runtime adoption (the UPSTREAM-6 reevaluation trigger, ADR-0026 §5):**')
    for (const cell of diff.sshBaseline) lines.push(`- ${cell.package}@${cell.tag} (${cell.version}) → ${cell.deps.join(', ')}`)
  }
  lines.push('')
  lines.push('Acknowledge by reviewing the packages above, then run '
    + '`node scripts/upstream-watch.mjs --write-baseline` and commit the regenerated baseline.')
  return lines.join('\n')
}

/** Read one host composition cell off the registry through the npm CLI. */
function queryCell(pkg, tag) {
  // This sentinel runs on CI runners and normal local shells, never under the
  // DSH file sandbox, so plain stdio pipes are fine here (AGENTS.md §4 applies
  // to sandboxed test runs, not to CI-facing scripts). `shell` is required for
  // npm.cmd on Windows — a .cmd shim cannot be spawned directly.
  const plain = spawnSync('npm', ['view', `${pkg}@${tag}`, 'version', ...DEP_FIELDS, '--json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32' })
  if (plain.error !== undefined || plain.status !== 0 || plain.stdout.trim() === '') {
    const why = plain.error?.message ?? String(plain.stderr ?? '').trim() ?? 'no output'
    throw new Error(`npm view ${pkg}@${tag} failed: ${why}`)
  }
  const manifest = JSON.parse(plain.stdout)
  return compositionCell(manifest.version ?? '(unknown)', deepDepsOf(manifest))
}

/** Fetch every observed cell (host packages × tags). */
export function observeRegistry() {
  const observed = {}
  for (const pkg of HOST_PACKAGES) {
    observed[pkg] = {}
    for (const tag of HOST_TAGS) observed[pkg][tag] = queryCell(pkg, tag)
  }
  return observed
}

function writeGithubOutput(name, value) {
  const target = process.env.GITHUB_OUTPUT
  if (target === undefined || target === '') return
  const delimiter = `dsw-watch-${name}`
  writeFileSync(target, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { flag: 'a' })
}

function main() {
  const writeBaseline = process.argv.includes('--write-baseline')
  const observed = observeRegistry()
  if (writeBaseline) {
    const baseline = {
      $comment: 'Acknowledged @deepseek-ai/* composition of the host packages, per dist-tag. '
        + 'The scope watch (upstream.yml) diffs live registry data against this file and opens an issue on drift; '
        + 'regenerate with `node scripts/upstream-watch.mjs --write-baseline` to acknowledge.',
      recordedAt: new Date().toISOString().slice(0, 10),
      hosts: observed,
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.error(`wrote ${BASELINE_PATH}`)
    return
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const diff = diffBaseline(baseline.hosts, observed)
  const report = renderReport(diff)
  if (report === '') {
    console.log('scope watch: no composition drift (baseline matches the registry)')
    writeGithubOutput('signal', '')
  } else {
    console.log(report)
    const reportDir = join(root, '.tmp')
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, 'upstream-watch-report.md')
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
