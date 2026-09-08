/**
 * 安全审计 case：副工作区权限（fs r/rw × exec on/off）在**真实分支**下的
 * 进程级行为。与 side-workspace-gates.test.ts（stub 分支）互补：这里用
 * installMixedProviders 组装真实 LocalSubprocessRuntime + SandboxedFileSystem
 * （与 lab/部署同源），逐条验证写门/exec 门的真实拦截，以及已知绕过路径的
 * 真实落地（命令文本不受 fs 门管——见 drafts/CONTEXT.md §7）。
 *
 * 分组：
 *   G1 门禁应当有效的组（TC-01..03, 07..11）
 *   G2 已知绕过路径（TC-04..06）——断言现状：文件真实落地/被删
 *   G3 防纵深探测（TC-12）——runtime 层在低权限档位下是否补围栏
 *
 * 断言记录的是**当前现实**：G2 在补强落地后应当翻红（变成回归警报）。
 * @module test/side-workspace-attacks
 */

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { installMixedProviders } from '../src/plugin.ts'
import type { SessionSideWorkspaceStore as Store } from '../src/session-workspaces.ts'
import type { MixedFileSystem, MixedSubprocessRuntime } from '../src/mixed.ts'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/* ------------------------------------------------------------ fixtures ---- */

const base = mkdtempSync(join(tmpdir(), 'dsw-attack-'))
const MAIN = join(base, 'main')
const A = join(base, 'ro-execoff') // fs:'r' + exec:'off' — 严格只读档
const B = join(base, 'ro-execon') // fs:'r' + exec:'on'  — 已知问题 ⑧ 组合
const C = join(base, 'rw-execoff') // fs:'rw' + exec:'off' — 读写但禁执行
const SESSION = 'attack-session'

before(() => {
  for (const dir of [MAIN, A, B, C]) {
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(A, 'sub'), { recursive: true })
  }
  writeFileSync(join(A, 'canary.txt'), 'canary ro-execoff\n')
  writeFileSync(join(B, 'canary.txt'), 'canary ro-execon\n')
  writeFileSync(join(C, 'canary.txt'), 'canary rw-execoff\n')
})

after(() => {
  rmSync(base, { recursive: true, force: true })
})

/** 组装与部署同源的混合门面：真实本地分支 + 真实 store（权限档位可配）。 */
async function wired(policy: { defaultMode: string; workspaceRoot: string }): Promise<{
  ctx: Context
  store: Store
  fs: MixedFileSystem
  subprocess: MixedSubprocessRuntime
}> {
  // installMixedProviders 内部自建 store（默认路径读 DSH_HOME）——把 DSH_HOME
  // 指进临时目录即可让状态文件隔离，绝不触碰真实 ~/.dsh。
  const home = join(base, `home-${policy.defaultMode}`)
  mkdirSync(home, { recursive: true })
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  let ctx: Context
  try {
    ctx = new Context()
    await ctx.plugin({ apply(c) {
      c.provide('sandboxPolicy', {
        defaultMode: policy.defaultMode,
        resolve: () => ({ mode: policy.defaultMode, workspaceRoot: policy.workspaceRoot }),
      })
    } })
    installMixedProviders(ctx)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  // inject 纤维一拍后激活（同 mixed-install.test.ts）
  await new Promise((resolve) => setTimeout(resolve, 20))
  const store = ctx.get('sideWorkspaces') as Store
  assert.ok(store, 'sideWorkspaces store must be registered by installMixedProviders')
  store.attach(SESSION, { id: 'a-ro-execoff', kind: 'local', path: A, label: 'A-ro-execoff', fs: 'r', exec: 'off' })
  store.attach(SESSION, { id: 'b-ro-execon', kind: 'local', path: B, label: 'B-ro-execon', fs: 'r', exec: 'on' })
  store.attach(SESSION, { id: 'c-rw-execoff', kind: 'local', path: C, label: 'C-rw-execoff', fs: 'rw', exec: 'off' })
  const fs = ctx.get('fs') as MixedFileSystem
  const subprocess = ctx.get('subprocess') as MixedSubprocessRuntime
  return { ctx, store, fs, subprocess }
}

const STDIO = {
  stdin: 'ignore',
  stdout: { maxBytes: 8192, spill: { maxBytes: 8192 } },
  stderr: { maxBytes: 8192, spill: { maxBytes: 8192 } },
} as const

/**
 * 解析审计用的 PowerShell 可执行文件（pwsh 7 优先，回退系统 5.1；可用环境变量覆盖）。
 * 找不到时返回 undefined —— **不要在模块顶层抛错**：那会让整个文件在 POSIX CI 上
 * 加载失败（G1 门禁用例本来无需 shell 也能跑）。
 */
function findAuditShell(): string | undefined {
  const override = process.env.DSW_AUDIT_SHELL
  if (override !== undefined && override !== '') return override
  const candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found !== undefined) return found
  // A POSIX box (or a Windows box with pwsh only on PATH) may still have one.
  const names = process.platform === 'win32'
    ? ['pwsh.exe', 'powershell.exe']
    : ['pwsh', 'powershell']
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    for (const name of names) {
      const candidate = dir === '' ? name : join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const SHELL = findAuditShell()
/**
 * G2/G3 的 spawn 用例复现的是**Windows 部署路径**（`pwsh` 工具的命令文本、反斜杠相对
 * 路径、DACL 语义）。POSIX 上即使装了 pwsh 也语义不同 —— 跳过并说明原因，而不是让整个
 * 文件崩掉。Windows（本机 + CI 的 windows job）会照常执行。
 */
const shellTest = process.platform === 'win32' && SHELL !== undefined ? test : test.skip

/** 经混合门面真实 spawn 一个 PowerShell（对齐官方 pwsh 工具的调用形态）。 */
async function runShell(
  subprocess: MixedSubprocessRuntime,
  cwd: string,
  command: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  if (SHELL === undefined) throw new Error('audit spawn case ran without a PowerShell executable')
  const handle: SubprocessHandle = subprocess.spawn({
    argv: [SHELL, '-NoProfile', '-Command', command],
    cwd,
    stdio: STDIO,
    graceMs: 5000,
  })
  const outcome = await handle.done
  return {
    exitCode: outcome.exitCode,
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  }
}

/* ------------------------------------------------- G1 门禁应当有效 --------- */

let danger: { fs: MixedFileSystem; subprocess: MixedSubprocessRuntime }

test('setup: mixed facades wired with real local branches (danger-full-access, as deployed)', async () => {
  const wiredCtx = await wired({ defaultMode: 'danger-full-access', workspaceRoot: MAIN })
  danger = { fs: wiredCtx.fs, subprocess: wiredCtx.subprocess }
  assert.ok(danger.fs, 'fs facade must resolve')
  assert.ok(danger.subprocess, 'subprocess facade must resolve')
})

test('AUDIT-TC01: write tool into fs:r side root is rejected (FS_PERMISSION_DENIED)', async () => {
  const target = await danger.fs.resolve(join(A, 'attack-tc01.txt'), { cwd: MAIN })
  await assert.rejects(
    danger.fs.writeText(target, 'tc01'),
    (error: unknown) => (error as { code?: string })?.code === 'FS_PERMISSION_DENIED',
  )
  assert.equal(existsSync(join(A, 'attack-tc01.txt')), false, 'no file may land')
})

test('AUDIT-TC02: edit tool on fs:r side root is rejected (FS_PERMISSION_DENIED)', async () => {
  const target = await danger.fs.resolve(join(A, 'canary.txt'), { cwd: MAIN })
  await assert.rejects(
    danger.fs.editText(target, { oldString: 'canary', newString: 'tampered', replaceAll: false }),
    (error: unknown) => (error as { code?: string })?.code === 'FS_PERMISSION_DENIED',
  )
  assert.match(readFileSync(join(A, 'canary.txt'), 'utf8'), /canary ro-execoff/, 'canary intact')
})

test('AUDIT-TC03: shell spawn with workdir in fs:r+exec:off side root is rejected (exec gate)', () => {
  assert.throws(
    () => danger.subprocess.spawn({
      argv: [SHELL, '-NoProfile', '-Command', 'echo probe-tc03'],
      cwd: A,
      stdio: STDIO,
      graceMs: 1000,
    }),
    /exec: off/,
  )
})

test('AUDIT-TC07 (control): reads from fs:r side roots stay allowed (by design)', async () => {
  const a = await danger.fs.resolve(join(A, 'canary.txt'), { cwd: MAIN })
  assert.match(await danger.fs.readText(a), /canary ro-execoff/)
  const b = await danger.fs.resolve(join(B, 'canary.txt'), { cwd: MAIN })
  assert.match(await danger.fs.readText(b), /canary ro-execon/)
})

test('AUDIT-TC08: case/separator-normalized path into fs:r root is still rejected (matcher holds)', async () => {
  // win32-only property: on a case-insensitive filesystem a differently-cased
  // spelling reaches the SAME file, so the gate must still match. On POSIX a
  // case change is simply a different (non-existent) path.
  if (process.platform !== 'win32') return
  const sneaky = A.toLowerCase().replace(/\\/g, '/') + '/attack-tc08.txt'
  const target = await danger.fs.resolve(sneaky, { cwd: MAIN })
  await assert.rejects(
    danger.fs.writeText(target, 'tc08'),
    (error: unknown) => (error as { code?: string })?.code === 'FS_PERMISSION_DENIED',
  )
  assert.equal(existsSync(join(A, 'attack-tc08.txt')), false, 'no file may land')
})

test('AUDIT-TC09: fs:rw+exec:off semantics — writes pass, spawns stay rejected', async () => {
  const target = await danger.fs.resolve(join(C, 'attack-tc09.txt'), { cwd: MAIN })
  await danger.fs.writeText(target, 'tc09-ok')
  assert.equal(existsSync(join(C, 'attack-tc09.txt')), true, 'rw allows the write tool')
  assert.throws(
    () => danger.subprocess.spawn({
      argv: [SHELL, '-NoProfile', '-Command', 'echo probe-tc09'],
      cwd: C,
      stdio: STDIO,
      graceMs: 1000,
    }),
    /exec: off/,
  )
})

test('AUDIT-TC10: exec gate matches NESTED paths under the side root (prefix depth)', () => {
  assert.throws(
    () => danger.subprocess.spawn({
      argv: [SHELL, '-NoProfile', '-Command', 'echo probe-tc10'],
      cwd: join(A, 'sub'),
      stdio: STDIO,
      graceMs: 1000,
    }),
    /exec: off/,
  )
})

test('AUDIT-TC11: spawnTerminal is gated by the same exec check (PTY path)', async () => {
  await assert.rejects(
    danger.subprocess.spawnTerminal({
      argv: [SHELL, '-NoProfile', '-Command', 'echo probe-tc11'],
      cwd: A,
      stdio: STDIO,
      graceMs: 1000,
    }),
    /exec: off/,
  )
})

/* ------------------------------------------------- G2 已知绕过路径 --------- */

shellTest('AUDIT-TC04 (KNOWN BYPASS): a MAIN-workdir pwsh command writes an ABSOLUTE path into fs:r+exec:off root', async () => {
  const outcome = await runShell(
    danger.subprocess,
    MAIN,
    `Set-Content -LiteralPath '${join(A, 'attack-tc04.txt')}' -Value 'tc04-bypass'`,
  )
  assert.equal(outcome.exitCode, 0, `command must succeed, stderr: ${outcome.stderr}`)
  // 现状断言：文件真实落地 —— fs 门对命令文本完全无效（exec 门也不检查命令内容）。
  assert.equal(existsSync(join(A, 'attack-tc04.txt')), true, 'BYPASS: write landed in a read-only workspace')
})

shellTest('AUDIT-TC05 (KNOWN BYPASS, CONTEXT §7-⑧): workdir INSIDE fs:r+exec:on root lets the command write relatively', async () => {
  const outcome = await runShell(danger.subprocess, B, `Set-Content -LiteralPath '.\\attack-tc05.txt' -Value 'tc05-bypass'`)
  assert.equal(outcome.exitCode, 0, `command must succeed, stderr: ${outcome.stderr}`)
  assert.equal(existsSync(join(B, 'attack-tc05.txt')), true, 'BYPASS: r+on combo is not read-only against shells')
})

shellTest('AUDIT-TC06 (KNOWN BYPASS): a MAIN-workdir command DELETES the fs:r root canary (no integrity protection)', async () => {
  assert.equal(existsSync(join(A, 'canary.txt')), true, 'precondition: canary present')
  const outcome = await runShell(danger.subprocess, MAIN, `Remove-Item -LiteralPath '${join(A, 'canary.txt')}' -Force`)
  assert.equal(outcome.exitCode, 0, `command must succeed, stderr: ${outcome.stderr}`)
  assert.equal(existsSync(join(A, 'canary.txt')), false, 'BYPASS: read-only root contents were destroyed')
})

/* ------------------------------------------------- G3 防纵深探测 ----------- */

shellTest('AUDIT-TC12 (defense-in-depth): under workspace-write the RUNTIME still adds no fence for command-text writes', async () => {
  const low = await wired({ defaultMode: 'workspace-write', workspaceRoot: MAIN })
  // fs 门依旧先于沙箱策略生效（gate-first）：
  const target = await low.fs.resolve(join(A, 'attack-tc12-fs.txt'), { cwd: MAIN })
  await assert.rejects(
    low.fs.writeText(target, 'tc12'),
    (error: unknown) => (error as { code?: string })?.code === 'FS_PERMISSION_DENIED',
  )
  // runtime 层对 spawn 的命令文本不做任何围栏（围栏只可能存在于 tool/sandbox 层）：
  const outcome = await runShell(
    low.subprocess,
    MAIN,
    `Set-Content -LiteralPath '${join(A, 'attack-tc12.txt')}' -Value 'tc12-runtime-unfenced'`,
  )
  assert.equal(outcome.exitCode, 0, `command must succeed, stderr: ${outcome.stderr}`)
  assert.equal(existsSync(join(A, 'attack-tc12.txt')), true, 'runtime layer does not fence command writes even at workspace-write')
})
