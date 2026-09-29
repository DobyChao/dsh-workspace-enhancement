#!/usr/bin/env node
/**
 * Capability preflight (INFRA-21) — the one command every agent (any harness)
 * runs at round start and at handoff, so capability gaps surface as BLOCKED
 * rows instead of silent skips.
 *
 *   node scripts/preflight.mjs          # human table
 *   node scripts/preflight.mjs --json   # machine-readable
 *
 * What it probes (environment side only):
 *   node ≥ 22.8 / npm / git / gh (auth) / wsl (+ a Linux shell) /
 *   lab ports 50599 & 50600 free / lab homes present / pack tarball present.
 *
 * What it deliberately does NOT probe: whether the RUNNING agent can drive a
 * browser. That is a model/harness property, not an environment fact — the
 * agent SELF-REPORTS it into the round report per AGENTS.md §7; a missing
 * capability marks the affected backlog row `agent-missing:<cap>` and moves it
 * to §3 (blocked), never a silent skip.
 *
 * Every probe is failure-tolerant: a probe that cannot run (e.g. spawn is
 * sandboxed away) reports `warn`, the script still exits 0 — preflight is a
 * REPORT, not a gate.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** One probe result: status drives the hint, never the exit code. */
function result(cap, status, detail, blocks) {
  return { cap, status, detail, blocks }
}

/** Run a command, capture first stdout line; never throws. */
function probe(cmd, args, shell = false) {
  try {
    const run = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15_000, shell })
    if (run.error !== undefined) return { ok: false, out: '' }
    return { ok: run.status === 0, out: String(run.stdout ?? '').split('\n')[0] ?? '' }
  } catch {
    return { ok: false, out: '' }
  }
}

async function portFree(port) {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
  })
}

async function run() {
  const results = []

  // node / npm / git — the baseline every round needs.
  const [major, minor] = process.versions.node.split('.').map(Number)
  results.push(major > 22 || (major === 22 && minor >= 8)
    ? result('node', 'ok', `v${process.versions.node} (≥ 22.8)`, '一切')
    : result('node', 'missing', `v${process.versions.node} < 22.8`, '全部轮次'))
  const npm = probe('npm', ['-v'], process.platform === 'win32')
  results.push(npm.ok
    ? result('npm', 'ok', npm.out, '安装/构建/发布准备')
    : result('npm', 'missing', 'npm 不可用', 'npm install / pack / e2e 安装'))
  const git = probe('git', ['--version'])
  results.push(git.ok
    ? result('git', 'ok', git.out, '分支/提交/push')
    : result('git', 'missing', 'git 不可用', '一轮的工作流（§7）'))

  // gh — PR/CI/issue 收尾。
  const gh = probe('gh', ['auth', 'status'], process.platform === 'win32')
  results.push(gh.ok
    ? result('gh', 'ok', '已登录', 'PR / CI 盯绿 / 哨兵 issue 处置')
    : result('gh', 'missing', 'gh 不可用或未登录', 'push 后的 PR 流程（§7 第 5 步）'))

  // wsl — Linux 复验与 Linux lab（INFRA-19）。
  const wsl = probe('wsl', ['-e', 'bash', '-c', 'echo ok'])
  results.push(wsl.ok
    ? result('wsl', 'ok', 'WSL bash 可用', 'verify-linux / dev-lab-wsl')
    : result('wsl', 'missing', 'WSL 不可用（或 bash 探测失败）', 'WSL 复验、Linux lab、矩阵 M/L2 的 Linux 半边'))

  // lab 端口 —— 占用不是错误（lab 可能正在跑），给 info。
  for (const port of [50599, 50600]) {
    const free = await portFree(port)
    results.push(result(`port ${port}`, free ? 'ok' : 'warn', free ? '空闲' : '被占用（lab 在跑？）', free ? `${port} lab` : '——'))
  }

  // lab homes / 打包产物。
  const labWin = join(homedir(), '.dsh-lab')
  results.push(existsSync(labWin)
    ? result('lab home (win32)', 'ok', labWin, 'win32 lab')
    : result('lab home (win32)', 'warn', `${labWin} 不存在（首次跑 dev-lab 会创建）`, 'win32 lab'))
  let tarball = null
  try {
    tarball = readdirSync(join(REPO, '.tmp')).filter(name => /^dsh-workspace-enhancement-.*\.tgz$/.test(name)).sort().pop() ?? null
  } catch { /* .tmp absent */ }
  results.push(tarball !== null
    ? result('pack tarball', 'ok', `.tmp/${tarball}`, 'lab 安装（tarball 流程）')
    : result('pack tarball', 'warn', '.tmp 无 dsh-workspace-enhancement-*.tgz（先 npm run build && npm pack）', 'lab 安装'))

  // 能力自报行 —— 永远打印，提醒这不是探测能覆盖的。
  const selfReport = {
    cap: 'browser-use（自报）',
    status: 'self-report',
    detail: '环境探测无法判定；agent 在 round 报告/PR 里自报。缺失 ⇒ 矩阵 L1/L2 相关行标 agent-missing:browser-use 进 §3，不静默跳过',
    blocks: '实机矩阵 L1/L2（docs/uat/matrix.md §5）',
  }

  const json = process.argv.includes('--json')
  if (json) {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), results, selfReport }, null, 2)}\n`)
    return
  }
  process.stdout.write('preflight（INFRA-21）：能力预检 —— 报告工具，不是闸门；缺能力 ⇒ 标 blocked，不静默跳过\n')
  for (const row of [...results, selfReport]) {
    const mark = row.status === 'ok' ? '✓' : row.status === 'missing' ? '✗' : row.status === 'warn' ? '!' : '?'
    process.stdout.write(`  ${mark} ${row.cap.padEnd(20)} ${row.status.padEnd(12)} ${row.detail}\n`)
    if (row.status === 'missing') process.stdout.write(`      ⇒ 受阻面：${row.blocks}（backlog 行标 agent-missing:${row.cap.replace(/（自报）/, '')} 进 §3）\n`)
  }
}

// CLI-only entry (no exports worth unit-testing: every probe is environmental).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
}
