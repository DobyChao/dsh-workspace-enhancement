#!/usr/bin/env node
/**
 * scripts/status.mjs — generate docs/status.md, the single state snapshot.
 *
 * Rationale: five hand-maintained status paragraphs drifted apart (AGENTS.md,
 * drafts/CONTEXT.md, docs/ROADMAP.md, CHANGELOG.md, tool-local notes). A
 * generated snapshot cannot drift: it is derived from git, package.json, the
 * test tree and docs/backlog.md every time it runs.
 *
 *   npm run status            # write docs/status.md
 *   npm run status -- --check # fail if the file on disk is stale
 *
 * Everything is captured through scripts/lib/run.mjs (file descriptors, not
 * pipes) so the script works inside the agent sandbox too.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { runCapture } from './lib/run.mjs'

const ROOT = resolve(dirname(fileURLToPath(new URL('.', import.meta.url))))
const OUT = join(ROOT, 'docs', 'status.md')
const checkOnly = process.argv.includes('--check')

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const read = path => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf-8') : '')
const listDir = path => (existsSync(join(ROOT, path)) ? readdirSync(join(ROOT, path)) : [])

function git(args) {
  const result = runCapture('git', args, { cwd: ROOT })
  return result.status === 0 ? result.stdout.trim() : ''
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown'
const head = git(['rev-parse', '--short', 'HEAD']) || 'unknown'
const headSubject = git(['log', '-1', '--format=%s']) || 'unknown'
const headDate = git(['log', '-1', '--format=%cs']) || 'unknown'
const tags = git(['tag', '--sort=-v:refname']).split('\n').filter(Boolean)
const latestTag = tags[0] ?? 'none'
/**
 * The remote default branch this board compares against. Resolved from
 * `origin/HEAD` (set by clone/fetch) with a fallback to the known names, so the
 * board survives the main -> master rename and either clone spelling.
 */
function upstreamRef() {
  const symbolic = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (symbolic) return symbolic
  for (const candidate of ['origin/master', 'origin/main']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate])) return candidate
  }
  return ''
}
const upstream = upstreamRef()
const aheadBehind = upstream ? git(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) : ''
const [behind, ahead] = aheadBehind ? aheadBehind.split(/\s+/).map(Number) : [NaN, NaN]
const remoteState = Number.isNaN(ahead)
  ? `unknown (no ${upstream || 'origin'} ref)`
  : ahead === 0 && behind === 0
    ? `in sync with ${upstream}`
    : `${ahead} ahead / ${behind} behind ${upstream}`

// Published version — best effort; offline is an acceptable answer.
function publishedVersion() {
  const npmCli = process.env.npm_execpath
    ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const result = runCapture(process.execPath, [npmCli, 'view', pkg.name, 'version'], {
    cwd: ROOT,
    timeoutMs: 20000,
    env: { ...process.env, npm_config_cache: join(ROOT, '.tmp', 'npm-cache') },
  })
  const value = result.stdout.trim()
  return result.status === 0 && /^\d+\.\d+\.\d+/.test(value) ? value : 'unknown (offline or unpublished)'
}

// Static test inventory (no runner needed, so the snapshot is always available).
const testFiles = listDir('test').filter(name => name.endsWith('.test.ts'))
const testCases = testFiles.reduce((total, name) => {
  const matches = readFileSync(join(ROOT, 'test', name), 'utf-8').match(/\btest\s*\(/g)
  return total + (matches?.length ?? 0)
}, 0)

// Backlog roll-up.
const backlog = read('docs/backlog.md')
const STATUSES = ['todo', 'doing', 'blocked', 'done', 'shipped', 'dropped']
const counts = Object.fromEntries(STATUSES.map(status => [status, 0]))
const blockedRows = []
for (const line of backlog.split(/\r?\n/)) {
  const match = line.match(/^\|\s*`?([A-Z][\w-]*\d)\s*\|(.*)$/)
  if (!match) continue
  const status = STATUSES.find(candidate => new RegExp(`\\|\\s*${candidate}\\s*\\|`).test(line))
  if (!status) continue
  counts[status] += 1
  if (status === 'blocked') {
    const title = match[2].split('|')[0].trim()
    blockedRows.push(`${match[1]} — ${title}`)
  }
}

const decisions = listDir('docs/decisions').filter(name => /^ADR-\d+.*\.md$/.test(name)).sort()
const rounds = listDir('docs/rounds').filter(name => /^R.*\.md$/.test(name) && name !== 'README.md').sort()
const specs = listDir('e2e/specs').filter(name => name.endsWith('.spec.ts')).sort()

const lines = []
lines.push('# 项目状态（生成文件，请勿手改）')
lines.push('')
lines.push(`> 由 \`npm run status\` 从 git / package.json / test/ / docs/backlog.md 生成。`)
lines.push(`> 生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · 唯一待办真相源：\`docs/backlog.md\``)
lines.push('')
lines.push('## 版本与提交')
lines.push('')
lines.push('| 项 | 值 |')
lines.push('|---|---|')
lines.push(`| package.json 版本 | \`${pkg.version}\` |`)
lines.push(`| npm 已发布版本 | \`${publishedVersion()}\` |`)
lines.push(`| 最新 tag | \`${latestTag}\` |`)
lines.push(`| 分支 / HEAD | \`${branch}\` / \`${head}\` |`)
lines.push(`| HEAD 提交 | \`${headSubject}\` (${headDate}) |`)
lines.push(`| 与远端 | ${remoteState} |`)
lines.push('')
lines.push('## 质量')
lines.push('')
lines.push('| 项 | 值 |')
lines.push('|---|---|')
lines.push(`| 单测文件 | ${testFiles.length} |`)
lines.push(`| 单测用例（静态计数） | ${testCases} |`)
lines.push(`| E2E 场景文件 | ${specs.length} |`)
lines.push(`| ADR | ${decisions.length} |`)
lines.push(`| 轮次报告 | ${rounds.length} |`)
lines.push('')
lines.push('## 待办分布（docs/backlog.md）')
lines.push('')
lines.push('| 状态 | 数量 |')
lines.push('|---|---|')
for (const status of STATUSES) lines.push(`| \`${status}\` | ${counts[status]} |`)
lines.push('')
lines.push('## 被挡住 / 待拍板')
lines.push('')
if (blockedRows.length === 0) lines.push('- （无）')
else for (const row of blockedRows) lines.push(`- ${row}`)
lines.push('')
lines.push('## 质量门')
lines.push('')
lines.push('| 命令 | 作用 | 谁能跑 |')
lines.push('|---|---|---|')
lines.push('| `npm run check` | 静态闸门 + typecheck + 单测 + build + pack 冒烟 | CI / 本地 shell |')
lines.push('| `npm run test:agent` | 单进程单测（无 esbuild，沙箱内可跑） | 代理 |')
lines.push('| `npm run e2e` | Playwright 黑盒验收（lab 实例） | 本地 shell / CI |')
lines.push('| `npm run status` | 重新生成本文件 | 任何人 |')
lines.push('')
lines.push('---')
lines.push('')
lines.push('改动状态请改 `docs/backlog.md`，然后重跑 `npm run status`；本文件由 CI 校验不得过期。')
lines.push('')
lines.push('> 说明：HEAD / tag / 待办分布以**生成时刻**为准，提交后重跑一次即可刷新（版本号与待办分布由闸门校验）。')
lines.push('')

const next = lines.join('\n')

if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf-8') : ''
  if (current !== next) {
    console.error('[status] docs/status.md is stale — run `npm run status`')
    process.exit(1)
  }
  console.log('[status] docs/status.md is up to date')
  process.exit(0)
}

writeFileSync(OUT, next, 'utf-8')
console.log(`[status] wrote docs/status.md (version=${pkg.version}, head=${head}, backlog=${Object.values(counts).reduce((a, b) => a + b, 0)} rows)`)
