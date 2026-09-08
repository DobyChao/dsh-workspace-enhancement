#!/usr/bin/env node
/**
 * scripts/check.mjs — static constraint gate.
 *
 * Runs before every build/test cycle and inside CI (`npm run check`). Zero
 * runtime deps; the dictionary import is delegated to `node --import tsx`
 * (a devDependency). Exits non-zero on any failed check.
 *
 *  1. zh/en dictionary key sets are strictly equal, no duplicate keys, and every
 *     `{name}` template parameter name matches between languages.
 *  2. No CJK string literal outside `src/locale/**` (comments/logs are stripped).
 *  3. No secrets / real host identities anywhere in the shipped or documented
 *     surface; no hardcoded loopback in `src/**` / `lib/**`.
 *  4. package.json version equals package-lock.json version.
 *  5. No `.only(` / `.skip(` focused tests left in `test/**`.
 *  6. Host-shared `@deepseek-ai/*` packages are peerDependencies (never
 *     dependencies), all on ONE rc family — the 2026-08-30 dependency split.
 *  7. CHANGELOG.md has a section for the current package version.
 *  8. docs/status.md (the single state snapshot) reports the current version.
 *  9. README.md and README.zh.md keep the same top-level structure.
 * 10. HEAD commit subject follows Conventional Commits.
 * 11. No stray build/test artifacts in the repository root.
 * 12. Every docs/backlog.md row carries an id and a status.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { runCapture } from './lib/run.mjs'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const HAN = /[\p{Script=Han}]/u
const failures = []

function check(name, ok, detail = '') {
  console.log(`[check.mjs] ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

function* walk(dir, ext, skip) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (skip.some(s => entry.name === s)) continue
    if (entry.isDirectory()) yield* walk(full, ext, skip)
    else if (ext.some(e => entry.name.endsWith(e))) yield full
  }
}

const read = path => readFileSync(resolve(ROOT, path), 'utf-8')
const rel = file => file.slice(ROOT.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
const pkg = JSON.parse(read('package.json'))

// ---- 1. dictionary key-set balance (native TS transform, no tsx) -----------
try {
  const run = runCapture(process.execPath, ['--experimental-transform-types', 'scripts/lib/dict-audit.mjs'], { cwd: ROOT })
  if (run.status !== 0) {
    throw new Error(run.stderr.trim().split('\n').slice(-2).join(' ') || `dict-audit exit ${run.status}`)
  }
  const r = JSON.parse(run.stdout.trim().split('\n').pop())
  check('dictionary key sets equal', r.zh === r.en && r.onlyZh.length === 0 && r.onlyEn.length === 0,
    `zh=${r.zh} en=${r.en} onlyZh=${JSON.stringify(r.onlyZh)} onlyEn=${JSON.stringify(r.onlyEn)}`)
  check('dictionary has no duplicate keys', r.duplicates.length === 0, JSON.stringify(r.duplicates))
  check('dictionary template parameters match zh/en', r.templateMismatch.length === 0,
    JSON.stringify(r.templateMismatch))
} catch (error) {
  check('dictionary key balance parseable', false, String(error.message || error))
}

// ---- 2. no CJK string literals outside src/locale/** -----------------------
/**
 * Strips comments (line `//`, block) and then reports CJK code points. String
 * literals are NOT stripped: a Han character inside a literal outside the
 * dictionary is exactly the hardcode this gate forbids.
 */
function codeWithoutComments(source) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; i += 2; continue }
      if (c === '/' && next === '*') { state = 'block'; i += 2; continue }
      out += c
      i += 1
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c }
      i += 1
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; i += 2; continue }
      if (c === '\n') out += c
      i += 1
      continue
    }
  }
  return out
}

const cjkHits = []
for (const file of walk(resolve(ROOT, 'src'), ['.ts', '.tsx'], ['locale', 'node_modules'])) {
  const code = codeWithoutComments(readFileSync(file, 'utf-8'))
  let line = 1
  let from = 0
  for (let idx = code.indexOf('\n'); idx !== -1; idx = code.indexOf('\n', from)) {
    if (HAN.test(code.slice(from, idx))) cjkHits.push(`${rel(file)}:${line}`)
    from = idx + 1
    line += 1
  }
  const last = code.slice(from)
  if (from === 0) {
    if (HAN.test(code)) cjkHits.push(`${rel(file)}:1`)
  } else if (HAN.test(last)) {
    cjkHits.push(`${rel(file)}:${line}`)
  }
}
check('no CJK string literal outside src/locale/**', cjkHits.length === 0, cjkHits.slice(0, 8).join(', '))

// ---- 3. secrets / real host identities -------------------------------------
// These must never appear anywhere a user or contributor can read.
const SECRET_PATTERNS = [
  ['real lab host identity (uuz@)', /uuz@/i],
  ['private key material', /BEGIN (RSA|OPENSSH|DSA|EC) PRIVATE/],
  ['ssh-rsa key blob', /ssh-rsa AAAA/],
]
// Hardcoding a loopback endpoint in the shipped runtime is a smell; docs and
// scripts may legitimately mention the lab address.
const HARDCODED_LOOPBACK = /127\.0\.0\.1/
const LOOPBACK_ALLOWED = [
  /forwardOut\('127\.0\.0\.1'/, // ProxyJump source address constant (ssh2 API)
]
const DOC_SURFACE = [
  'README.md', 'README.zh.md', 'CHANGELOG.md', 'AGENTS.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'docs', 'src', 'lib', 'scripts', '.github', 'e2e',
]
const secretHits = []
// The scanner itself necessarily contains the patterns it looks for.
const SCANNER_SELF = 'scripts/check.mjs'
for (const area of DOC_SURFACE) {
  const full = resolve(ROOT, area)
  if (!existsSync(full)) continue
  const files = full.endsWith('.md') ? [full]
    : walk(full, ['.md', '.ts', '.tsx', '.js', '.mjs', '.css', '.yml', '.yaml'], ['node_modules', 'locale', 'artifacts'])
  for (const file of files) {
    if (rel(file) === SCANNER_SELF) continue
    readFileSync(file, 'utf-8').split(/\r?\n/).forEach((line, i) => {
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(line)) secretHits.push(`${label} in ${rel(file)}:${i + 1}`)
      }
      if (area === 'src' || area === 'lib') {
        if (HARDCODED_LOOPBACK.test(line) && !LOOPBACK_ALLOWED.some(re => re.test(line))) {
          secretHits.push(`hardcoded loopback in ${rel(file)}:${i + 1}`)
        }
      }
    })
  }
}
check('no secrets / real hosts on the public surface', secretHits.length === 0, secretHits.slice(0, 8).join(', '))

// ---- 4. version consistency -------------------------------------------------
try {
  const lock = JSON.parse(read('package-lock.json'))
  check('package.json version equals package-lock.json version',
    pkg.version === lock.version, `pkg=${pkg.version} lock=${lock.version}`)
} catch (error) {
  check('package version parse', false, String(error.message || error))
}

// ---- 5. no focused tests ----------------------------------------------------
let focused = 0
if (existsSync(resolve(ROOT, 'test'))) {
  for (const file of walk(resolve(ROOT, 'test'), ['.ts'], ['node_modules'])) {
    const m = readFileSync(file, 'utf-8').match(/\.(only|skip)\s*\(/g)
    if (m) { focused += m.length; console.log(`[check.mjs] focused test marker in ${rel(file)}`) }
  }
}
check('no focused (.only/.skip) tests', focused === 0, `${focused} marker(s)`)

// ---- 6. host-shared packages: peerDependencies, one rc family --------------
const peer = pkg.peerDependencies ?? {}
const deps = pkg.dependencies ?? {}
const dev = pkg.devDependencies ?? {}
const isHostFamily = name => name.startsWith('@deepseek-ai/dsh-')
const hostInDeps = Object.keys(deps).filter(isHostFamily)
check('host-shared packages are never dependencies', hostInDeps.length === 0, hostInDeps.join(', '))

const family = new Map()
for (const source of [peer, dev]) {
  for (const [name, range] of Object.entries(source)) {
    if (!isHostFamily(name)) continue
    const core = String(range).replace(/^[\^~>=<\s]+/, '')
    if (!family.has(core)) family.set(core, [])
    family.get(core).push(name)
  }
}
check('@deepseek-ai/dsh-* declared on one rc family', family.size === 1,
  [...family.entries()].map(([core, names]) => `${core}: ${names.length} pkg`).join(' | '))

const nonRcPeers = Object.entries(peer)
  .filter(([name, range]) => isHostFamily(name) && !String(range).includes('-rc.'))
  .map(([name, range]) => `${name}@${range}`)
check('peer ranges use the rc channel', nonRcPeers.length === 0, nonRcPeers.join(', '))

// ---- 7. CHANGELOG covers the current version -------------------------------
try {
  const changelog = read('CHANGELOG.md')
  const escaped = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  check('CHANGELOG.md documents the current version',
    new RegExp(`^##\\s*\\[?${escaped}\\]?`, 'm').test(changelog), `version=${pkg.version}`)
} catch (error) {
  check('CHANGELOG.md readable', false, String(error.message || error))
}

// ---- 8. the state snapshot is not stale ------------------------------------
try {
  const status = read('docs/status.md')
  check('docs/status.md reports the current version',
    status.includes(pkg.version), `version=${pkg.version} — run \`npm run status\``)
} catch (error) {
  check('docs/status.md exists', false, `${String(error.message || error)} — run \`npm run status\``)
}

// ---- 9. README language parity --------------------------------------------
try {
  const headings = path => (read(path).match(/^##\s+/gm) ?? []).length
  const en = headings('README.md')
  const zh = headings('README.zh.md')
  check('README.md and README.zh.md keep the same structure', en === zh && en > 0,
    `en=${en} zh=${zh} level-2 headings`)
} catch (error) {
  check('READMEs readable', false, String(error.message || error))
}

// ---- 10. Conventional Commits on HEAD --------------------------------------
try {
  // --no-merges: a PR checkout has a synthetic merge commit as HEAD.
  const git = runCapture('git', ['log', '-1', '--no-merges', '--format=%s'], { cwd: ROOT })
  if (git.status !== 0) throw new Error(git.stderr.trim() || `git exit ${git.status}`)
  const subject = git.stdout.trim()
  const ok = /^(feat|fix|docs|test|chore|refactor|perf|build|ci|revert)(\([a-z0-9._-]+\))?!?:\s.{1,}$/.test(subject)
  check('HEAD commit follows Conventional Commits', ok,
    ok
      ? subject.slice(0, 90)
      : `${subject.slice(0, 90)} — a squash merge uses the PR TITLE as the subject; rename the PR or amend the commit`)
} catch (error) {
  check('git log readable', false, String(error.message || error))
}

// ---- 11. no stray artifacts in the repository root -------------------------
// Directory listing (not existsSync): on Windows `resolve(root,'nul')` resolves
// to the NUL device and existsSync reports a phantom file.
const FORBIDDEN_ROOT = ['nul', 'smoke-install.txt', 'dsh-ssh-connections.json.bak']
const rootEntries = new Set(readdirSync(ROOT))
const stray = FORBIDDEN_ROOT.filter(name => rootEntries.has(name))
check('repository root has no stray artifacts', stray.length === 0, stray.join(', '))

// ---- 12. backlog rows carry an id and a status -----------------------------
try {
  const backlog = read('docs/backlog.md')
  const rows = backlog.split(/\r?\n/).filter(line => /^\|\s*`?[A-Z][\w-]*\d\s*\|/.test(line))
  const bad = rows.filter(line => !/\|\s*(todo|doing|done|blocked|dropped|shipped)\s*\|/i.test(line))
  check('docs/backlog.md rows carry a status', rows.length > 0 && bad.length === 0,
    `${rows.length} row(s), ${bad.length} malformed`)
} catch (error) {
  check('docs/backlog.md readable', false, String(error.message || error))
}

// ---- result ----------------------------------------------------------------
console.log(failures.length === 0
  ? '[check.mjs] ALL PASS'
  : `[check.mjs] ${failures.length} FAILURE(S): ${failures.join(' | ')}`)
process.exit(failures.length === 0 ? 0 : 1)
