#!/usr/bin/env node
/**
 * scripts/test-agent.mjs — run the unit suite inside an agent sandbox.
 *
 * Why this exists: under the DSH file sandbox (workspace-write) a process may
 * not open named pipes, so `node --test` (which spawns one child per file) and
 * `tsx` (esbuild service worker) both die with `spawn EPERM`. `tsc --noEmit`
 * works because it never spawns. This runner keeps the suite single-process and
 * uses Node's built-in TypeScript transform instead of esbuild:
 *
 *   node --experimental-transform-types --test --experimental-test-isolation=none <files>
 *
 * Two honest limitations, both reported explicitly:
 *   1. `.tsx` imports need esbuild → those files are SKIPPED (run `npm test`).
 *   2. Tests that spawn real processes / copy Windows DACLs are blocked by the
 *      sandbox → their failures are classified as SANDBOX and do not fail the
 *      run. Any failure that does NOT look environmental still exits non-zero.
 *
 * The authoritative gate remains `npm test` (CI / normal shell).
 */
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(new URL('.', import.meta.url))))
const TEST_DIR = join(ROOT, 'test')

// Failures caused by the sandbox, not by the code under test.
const SANDBOX_MARKERS = [
  'spawn EPERM',
  "code: 'EPERM'",
  'SetFileSecurityW',
  "code: 'EACCES'",
  'operation not permitted',
]

const all = readdirSync(TEST_DIR)
  .filter(name => name.endsWith('.test.ts'))
  .sort()

const runnable = []
const skipped = []
for (const name of all) {
  const source = readFileSync(join(TEST_DIR, name), 'utf-8')
  // A direct `.tsx` import is the only thing native type-stripping cannot do.
  if (/\bfrom\s+['"][^'"]+\.tsx['"]/.test(source)) skipped.push(name)
  else runnable.push(join('test', name))
}

console.log(`[test-agent] ${all.length} test files: ${runnable.length} runnable, ${skipped.length} need esbuild (JSX)`)
for (const name of skipped) {
  console.log(`[test-agent] SKIP  ${name} — imports a .tsx module; run \`npm test\` for this one`)
}

if (runnable.length === 0) {
  console.error('[test-agent] no runnable test files')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-test-agent-'))
const logPath = join(work, 'run.log')
const fd = openSync(logPath, 'w')
let result
try {
  result = spawnSync(process.execPath, [
    '--experimental-transform-types',
    '--test',
    '--experimental-test-isolation=none',
    ...runnable,
  ], {
    cwd: ROOT,
    // File descriptors work under the sandbox; pipes do not.
    stdio: ['ignore', fd, fd],
  })
} finally {
  closeSync(fd)
}

const log = readFileSync(logPath, 'utf-8')
process.stdout.write(log)

if (result.error) {
  console.error(`[test-agent] failed to start the test runner: ${result.error.message}`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

// Split the "failing tests:" tail into one block per failure and classify it.
const tail = log.slice(log.indexOf('failing tests:'))
const blocks = tail
  .split(/\n(?=test at )/)
  .filter(block => block.startsWith('test at '))

const sandboxOnly = blocks.filter(block => SANDBOX_MARKERS.some(marker => block.includes(marker)))
const real = blocks.filter(block => !SANDBOX_MARKERS.some(marker => block.includes(marker)))

rmSync(work, { recursive: true, force: true })

if (result.status === 0) {
  console.log(`[test-agent] PASS — ${runnable.length} file(s), ${skipped.length} skipped (JSX)`)
  process.exit(0)
}

if (real.length === 0 && blocks.length > 0) {
  console.log(`[test-agent] SANDBOX-LIMITED PASS — ${blocks.length} failure(s), all blocked by the file sandbox:`
    + ' process spawn / Windows DACL copy are unavailable here.')
  console.log('[test-agent] These same tests must pass in CI (`npm test`); do not treat this as a code failure.')
  process.exit(0)
}

console.log(`[test-agent] FAIL — ${real.length} genuine failure(s)`
  + (sandboxOnly.length > 0 ? `, ${sandboxOnly.length} sandbox-limited` : ''))
process.exit(1)
