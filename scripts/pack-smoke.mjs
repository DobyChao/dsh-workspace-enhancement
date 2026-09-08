#!/usr/bin/env node
/**
 * scripts/pack-smoke.mjs — publish-surface gate.
 *
 * `npm pack --dry-run` is the last honest look at what a user receives. This
 * script asserts the tarball contains the host entry, the client bundle and the
 * composition patch, and that nothing private (source, tests, drafts, secrets,
 * machine data) leaks into it.
 *
 * Output is captured through a temp file descriptor instead of a pipe: under the
 * DSH sandbox piped stdio fails with EPERM, file redirection does not.
 */
import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(new URL('.', import.meta.url))))

const MUST_INCLUDE = [
  'lib/index.js',
  'lib/index.d.ts',
  'lib/client.js',
  'cordis.patch.yml',
  'package.json',
  'README.md',
  'LICENSE',
]

const MUST_EXCLUDE = [
  /^src\//,
  /^test\//,
  /^e2e\//,
  /^drafts\//,
  /^docs\//,
  /^scripts\//,
  /^\.github\//,
  /^node_modules\//,
  /^lib\/.*\.map$/,
  /(^|\/)machines\.json$/,
  /(^|\/)known_hosts\.json$/,
  /(^|\/)\.env/,
]

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`[pack-smoke] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

/**
 * Resolve how to run `npm pack`.
 *
 * `npm_execpath` is set when this script runs under `npm run check` (CI and the
 * normal path). Running the script directly (`node scripts/pack-smoke.mjs`) has
 * no such variable, so fall back to the CLI next to the running node, then to
 * `npm` on PATH.
 */
function npmInvocation() {
  const execpath = process.env.npm_execpath
  if (execpath !== undefined && execpath !== '' && existsSync(execpath)) {
    return { command: process.execPath, args: [execpath], shell: false }
  }
  const beside = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(beside)) return { command: process.execPath, args: [beside], shell: false }
  const isWindows = process.platform === 'win32'
  return { command: isWindows ? 'npm.cmd' : 'npm', args: [], shell: isWindows }
}

const work = mkdtempSync(join(tmpdir(), 'dsh-pack-smoke-'))
const outPath = join(work, 'pack.json')
const errPath = join(work, 'pack.err')
const outFd = openSync(outPath, 'w')
const errFd = openSync(errPath, 'w')
let result
try {
  const npm = npmInvocation()
  result = spawnSync(npm.command, [...npm.args, 'pack', '--dry-run', '--json'], {
    cwd: ROOT,
    shell: npm.shell,
    stdio: ['ignore', outFd, errFd],
  })
} finally {
  closeSync(outFd)
  closeSync(errFd)
}

const stderr = readFileSync(errPath, 'utf-8').trim()
const stdout = readFileSync(outPath, 'utf-8').trim()

if (result.error || result.status !== 0) {
  check('npm pack --dry-run exits 0', false, (result.error?.message || stderr || stdout).slice(0, 400))
  console.log(`[pack-smoke] ${failures.length} FAILURE(S)`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

let report
try {
  report = JSON.parse(stdout)
  if (Array.isArray(report)) report = report[0]
} catch (error) {
  check('npm pack --dry-run emits JSON', false, String(error.message).slice(0, 200))
  console.log(`[pack-smoke] ${failures.length} FAILURE(S)`)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
}

const files = (report.files ?? []).map(entry => entry.path.replace(/\\/g, '/'))
const set = new Set(files)

for (const wanted of MUST_INCLUDE) {
  check(`tarball contains ${wanted}`, set.has(wanted))
}

const leaked = files.filter(path => MUST_EXCLUDE.some(re => re.test(path)))
check('tarball leaks no private paths', leaked.length === 0, leaked.slice(0, 8).join(', '))

const sizeMb = (report.size ?? 0) / 1024 / 1024
check('tarball size under 5 MB', sizeMb < 5, `${sizeMb.toFixed(2)} MB`)

console.log(files.length === 0
  ? '[pack-smoke] FAIL — empty file list'
  : `[pack-smoke] ${files.length} files in the tarball`)
console.log(failures.length === 0
  ? '[pack-smoke] ALL PASS'
  : `[pack-smoke] ${failures.length} FAILURE(S): ${failures.join(' | ')}`)

rmSync(work, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)
