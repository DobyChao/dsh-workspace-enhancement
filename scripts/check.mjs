#!/usr/bin/env node
/**
 * scripts/check.mjs — static constraint gate for dsh-workspace-enhancement.
 *
 * Runs BEFORE a release or a lab deploy (AGENTS.md §4). Zero runtime deps
 * (the dictionary import is delegated to `node --import tsx` which is a
 * devDependency). Exits non-zero on any failed check:
 *
 *  1. zh/en dictionary key sets are strictly equal, no duplicate keys, and
 *     every `{name}` template parameter name matches between languages.
 *  2. No CJK string literal outside `src/locale/**` (comments and logs are
 *     stripped by the scanner first).
 *  3. No secrets / real hosts / user paths in `src/**`, `lib/**` or configs
 *     (real host, user, path material must never reach the pack).
 *  4. package.json version equals package-lock.json version.
 *  5. No `.only(` focused tests left in `test/**`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const HAN = /[\p{Script=Han}]/u
const failures = []

function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`[check.mjs] ${status}  ${name}${detail ? ` — ${detail}` : ''}`)
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

// ---- 1. dictionary key-set balance (via the real modules, tsx) -------------
try {
  const script = [
    "import { zh, en } from './src/locale/index.ts'",
    'const zk = Object.keys(zh), ek = Object.keys(en)',
    'const onlyZ = zk.filter(k => !(k in en))',
    'const onlyE = ek.filter(k => !(k in zh))',
    'const dups = zk.filter((k, i) => zk.indexOf(k) !== i)',
    'const tmpl = (k) => (t => { const m = [...new Set((t||"").match(/\\{(\\w+)\\}/g) || [])].sort(); return m.join(" ") })(zh[k])',
    'const tmplEn = (k) => (t => { const m = [...new Set((t||"").match(/\\{(\\w+)\\}/g) || [])].sort(); return m.join(" ") })(en[k])',
    'const badT = zk.filter(k => tmpl(k) !== tmplEn(k))',
    'console.log(JSON.stringify({ zh: zk.length, en: ek.length, onlyZ, onlyE, dups, badT }))',
  ].join('\n')
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--eval', script], {
    cwd: ROOT, encoding: 'utf-8',
  })
  const r = JSON.parse(out.trim().split('\n').pop())
  check('dictionary key sets equal', r.zh === r.en && r.onlyZ.length === 0 && r.onlyE.length === 0,
    `zh=${r.zh} en=${r.en} onlyZh=${JSON.stringify(r.onlyZ)} onlyEn=${JSON.stringify(r.onlyE)}`)
  check('dictionary has no duplicate keys', r.dups.length === 0, JSON.stringify(r.dups))
  check('dictionary template parameters match zh/en', r.badT.length === 0,
    JSON.stringify(r.badT))
} catch (error) {
  check('dictionary key balance parseable', false, String(error.message || error))
}

// ---- 2. no CJK string literals outside src/locale/** -----------------------
/**
 * Small scanner that strips comments (line `//`, block `/* *​/`) and then
 * reports CJK code points. String literals (single/double/backtick quotes)
 * are NOT stripped: a Han character inside a literal outside the dictionary
 * is exactly the hardcode this gate forbids. Regex literals never contain Han
 * in this codebase; if one ever does, it must be moved to a variable.
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
  const text = readFileSync(file, 'utf-8')
  const code = codeWithoutComments(text)
  let line = 1
  let from = 0
  for (let idx = code.indexOf('\n'); idx !== -1; idx = code.indexOf('\n', from)) {
    if (HAN.test(code.slice(from, idx))) cjkHits.push(`${file.replace(ROOT + '\\', '')}:${line}`)
    from = idx + 1
    line += 1
  }
  const last = code.slice(from)
  if (from === 0) {
    if (HAN.test(code)) cjkHits.push(`${file.replace(ROOT + '\\', '')}:1`)
  } else if (HAN.test(last)) {
    cjkHits.push(`${file.replace(ROOT + '\\', '')}:${line}`)
  }
}
check('no CJK string literal outside src/locale/**', cjkHits.length === 0, cjkHits.slice(0, 8).join(', '))

// ---- 3. secrets / real host info ------------------------------------------
const SECRET_PATTERNS = [
  ['real lab host (uuz@)', /uuz@/],
  ['loopback real host (127.0.0.1)', /127\.0\.0\.1/],
  ['private key material', /BEGIN (RSA|OPENSSH|DSA|EC) PRIVATE/],
  ['ssh-rsa key blob', /ssh-rsa AAAA/],
]
// Legitimate non-secret uses (protocol constants, not leaked environment):
const ALLOWED_LINES = [
  /forwardOut\('127\.0\.0\.1'/, // ProxyJump source address constant (ssh2 API)
]
const secretHits = []
for (const area of ['src', 'lib']) {
  if (!existsSync(resolve(ROOT, area))) continue
  for (const file of walk(resolve(ROOT, area), ['.ts', '.tsx', '.js', '.mjs', '.css'], ['node_modules', 'locale'])) {
    const lines = readFileSync(file, 'utf-8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (ALLOWED_LINES.some(re => re.test(line))) return
      for (const [label, re] of SECRET_PATTERNS) {
        if (re.test(line)) secretHits.push(`${label} in ${file.replace(ROOT + '\\', '')}:${i + 1}`)
      }
    })
  }
}
check('no secrets / real hosts in src+lib', secretHits.length === 0, secretHits.slice(0, 8).join(', '))

// ---- 4. version consistency -------------------------------------------------
try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf-8'))
  check('package.json version equals package-lock.json version',
    pkg.version === lock.version, `pkg=${pkg.version} lock=${lock.version}`)
} catch (error) {
  check('package version parse', false, String(error.message || error))
}

// ---- 5. no focused tests ----------------------------------------------------
let focused = 0
if (existsSync(resolve(ROOT, 'test'))) {
  for (const file of walk(resolve(ROOT, 'test'), ['.ts'], ['node_modules'])) {
    const text = readFileSync(file, 'utf-8')
    const m = text.match(/\.(only|skip)\s*\(/g)
    if (m) { focused += m.length; console.log(`[check.mjs] focused test marker in ${file.replace(ROOT + '\\', '')}`) }
  }
}
check('no focused (.only/.skip) tests', focused === 0, `${focused} marker(s)`)

// ---- result ----------------------------------------------------------------
console.log(failures.length === 0
  ? '[check.mjs] ALL PASS'
  : `[check.mjs] ${failures.length} FAILURE(S): ${failures.join(' | ')}`)
process.exit(failures.length === 0 ? 0 : 1)
