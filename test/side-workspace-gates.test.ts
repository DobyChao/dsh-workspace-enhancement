/**
 * R5 T2–T4 单测：侧工作区（副目录）在混合门面上的行为 ——
 * resolve/lstat 按「路径命中侧根」路由（即使 cwd 在另一个世界）、
 * fs 写门（fs:'r' 拒绝 writeText/editText、读放行）、exec 门
 * （exec:'off' 拒绝 cwd/argv[0] 命中侧根 的 spawn/终端、on 放行）。
 * 侧根数据用真实 SessionSideWorkspaceStore（临时文件）驱动。
 * @module test/side-workspace-gates
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { FsError, FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MixedFileSystem, MixedSubprocessRuntime } from '../src/mixed.ts'
import type { FileSystemBranch, SubprocessBranch } from '../src/mixed.ts'
import { SessionSideWorkspaceStore } from '../src/session-workspaces.ts'
import type { SideWorkspaceItem } from '../src/session-workspaces.ts'
import { sshRoutesRoot } from '../src/transport.ts'

const LOCAL_ROOT = resolve(tmpdir(), 'dsw-side', 'local-proj')
const REMOTE_ROOT = 'ssh://c1/srv/work'
const REMOTE_CWD = 'ssh://c1/srv/work' // remote-spelled main cwd (worldOfCwd → remote)
const NEUTRAL_LOCAL_CWD = resolve(tmpdir(), 'dsw-side', 'main')

function sideStore(): SessionSideWorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sideg-'))
  return new SessionSideWorkspaceStore(new Context(), { file: join(dir, 's.json') })
}

/* --------------------------------------------------- fs 分支替身 */

function stubFs(label: 'local' | 'remote', calls: string[]): FileSystemBranch {
  return {
    async resolve(path: string): Promise<FsTarget> {
      calls.push(`resolve:${label}:${JSON.stringify(path)}`)
      return { targetKey: FsTargetKey(label === 'remote' ? `ssh://c1${path}` : resolve(path)), displayPath: path }
    },
    processPath(target: FsTarget): string {
      calls.push(`processPath:${label}`)
      return String(target.targetKey)
    },
    fileUrl(target: FsTarget): string {
      calls.push(`fileUrl:${label}`)
      return String(target.targetKey)
    },
    contains(): boolean {
      calls.push(`contains:${label}`)
      return false
    },
    async stat(): Promise<undefined> {
      calls.push(`stat:${label}`)
      return undefined
    },
    async lstat(): Promise<undefined> {
      calls.push(`lstat:${label}`)
      return undefined
    },
    async readText(): Promise<string> {
      calls.push(`readText:${label}`)
      return ''
    },
    async streamText(): Promise<AsyncIterable<string>> {
      calls.push(`streamText:${label}`)
      return (async function* () {})()
    },
    async readBytes(): Promise<Uint8Array> {
      calls.push(`readBytes:${label}`)
      return new Uint8Array()
    },
    async listDir(): Promise<never[]> {
      calls.push(`listDir:${label}`)
      return []
    },
    async writeText(): Promise<never> {
      calls.push(`writeText:${label}`)
      throw new Error(`branch reached: ${label}`)
    },
    async editText(): Promise<never> {
      calls.push(`editText:${label}`)
      throw new Error(`branch reached: ${label}`)
    },
  }
}

/** One side record preset on the store (attached to session s1). */
function attachSides(store: SessionSideWorkspaceStore, presets: Array<{ id: string; kind: 'local' | 'remote'; path: string; fs?: 'r' | 'rw'; exec?: 'on' | 'off' }>): void {
  for (const preset of presets) store.attach('s1', preset)
}

/* ------------------------------------------------ 1) resolve/lstat 侧根路由 */

test('T2: resolve routes a remote side-root PATH to the remote branch even with a local cwd', async () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-r', kind: 'remote', path: REMOTE_ROOT }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)

  const target = await mixed.resolve('ssh://c1/srv/work/x.txt', { cwd: LOCAL_ROOT })
  assert.deepEqual(remoteCalls, [`resolve:remote:${JSON.stringify('/srv/work/x.txt')}`])
  assert.deepEqual(localCalls, [])
  assert.equal(String(target.targetKey), 'ssh://c1/srv/work/x.txt')

  // A path OUTSIDE any side root falls back to the cwd world (local here).
  const plain = await mixed.resolve('not-side.txt', { cwd: LOCAL_ROOT })
  assert.equal(String(plain.targetKey), resolve('not-side.txt'))
  assert.deepEqual(localCalls, [`resolve:local:${JSON.stringify('not-side.txt')}`])
})

test('T2: resolve/lstat route a local side-root PATH to the local branch even with a remote cwd', async () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-l', kind: 'local', path: LOCAL_ROOT }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)

  const target = await mixed.resolve(join(LOCAL_ROOT, 'notes.txt'), { cwd: REMOTE_CWD })
  assert.deepEqual(localCalls, [`resolve:local:${JSON.stringify(join(LOCAL_ROOT, 'notes.txt'))}`])
  assert.deepEqual(remoteCalls, [])
  assert.equal(String(target.targetKey), resolve(join(LOCAL_ROOT, 'notes.txt')))

  await mixed.lstat(join(LOCAL_ROOT, 'notes.txt'), { cwd: REMOTE_CWD })
  assert.deepEqual(localCalls.slice(1), [`lstat:local`])
  assert.deepEqual(remoteCalls, [])
})

test('T2: resolve without a matching side root keeps the cwd-world routing', async () => {
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => sideStore())
  await mixed.resolve('srv/work/x.txt', { cwd: REMOTE_CWD })
  assert.deepEqual(remoteCalls, [`resolve:remote:${JSON.stringify('srv/work/x.txt')}`])
  assert.deepEqual(localCalls, [])
})

/* ----------------------------------------------------- 2) fs 写门 */

test('T3: writeText/editText reject on a fs:r side workspace; reads still pass', async () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-r', kind: 'remote', path: REMOTE_ROOT, fs: 'r' }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)
  const sideTarget = { targetKey: FsTargetKey('ssh://c1/srv/work/conf.txt'), displayPath: 'ssh://c1/srv/work/conf.txt' }

  await assert.rejects(
    () => mixed.writeText(sideTarget, 'x'),
    (error: unknown) => error instanceof FsError && error.code === 'FS_PERMISSION_DENIED' && /read-only/.test(error.message),
  )
  await assert.rejects(
    () => mixed.editText(sideTarget, { oldString: 'a', newString: 'b' }),
    (error: unknown) => error instanceof FsError && error.code === 'FS_PERMISSION_DENIED',
  )
  assert.deepEqual(remoteCalls, []) // never reached the branch
  assert.deepEqual(localCalls, [])

  // Reads are never gated.
  await mixed.readText(sideTarget)
  await mixed.stat(sideTarget)
  assert.deepEqual(remoteCalls.slice(0, 2), ['readText:remote', 'stat:remote'])
})

test('T3: writeText passes on a rw side workspace and on non-side targets', async () => {
  const store = sideStore()
  attachSides(store, [
    { id: 'sw-rw', kind: 'remote', path: REMOTE_ROOT, fs: 'rw' },
    { id: 'sw-ro', kind: 'local', path: LOCAL_ROOT, fs: 'r' },
  ])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)
  const rwTarget = { targetKey: FsTargetKey('ssh://c1/srv/work/ok.txt'), displayPath: 'ssh://c1/srv/work/ok.txt' }
  const localRoTarget = { targetKey: FsTargetKey(resolve(LOCAL_ROOT, 'f.txt')), displayPath: resolve(LOCAL_ROOT, 'f.txt') }

  await assert.rejects(() => mixed.writeText(rwTarget, 'x'), /branch reached: remote/) // gate passed → branch
  await assert.rejects(() => mixed.writeText(localRoTarget, 'x'), (error: unknown) => error instanceof FsError && error.code === 'FS_PERMISSION_DENIED')
  await assert.rejects(() => mixed.writeText({ targetKey: FsTargetKey(resolve(tmpdir(), 'elsewhere', 'f.txt')), displayPath: 'f.txt' }, 'x'), /branch reached: local/)
  assert.deepEqual(remoteCalls, ['writeText:remote'])
  assert.deepEqual(localCalls, ['writeText:local'])
})

/* ------------------------------------------------------- 3) exec 门 */

function stubProc(label: 'local' | 'remote', calls: string[]): SubprocessBranch {
  return {
    async resolveExecutable(): Promise<string> {
      calls.push(`resolve:${label}`)
      return 'x'
    },
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      calls.push(`spawn:${label}:cwd=${String(spec.cwd)}:argv0=${String(spec.argv[0])}`)
      throw new Error(`branch reached: ${label}`)
    },
    async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<never> {
      calls.push(`terminal:${label}:cwd=${String(spec.cwd)}:argv0=${String(spec.argv[0])}`)
      throw new Error(`branch reached: ${label}`)
    },
  }
}

function spawnSpec(cwd: string | undefined, argv0: string): SubprocessSpawnSpec {
  return { argv: [argv0], ...(cwd !== undefined ? { cwd } : {}), stdio: { stdin: 'ignore', stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } }, graceMs: 1000 }
}

test('T4: spawn on an exec:off side workspace is rejected by cwd or absolute argv[0]', () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-x', kind: 'remote', path: REMOTE_ROOT, exec: 'off' }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedSubprocessRuntime(stubProc('local', localCalls), stubProc('remote', remoteCalls) as never, () => store)

  assert.throws(() => mixed.spawn(spawnSpec('ssh://c1/srv/work', 'bash')), /execution is disabled/)
  assert.throws(() => mixed.spawn(spawnSpec(LOCAL_ROOT, 'ssh://c1/srv/work/run.sh')), /execution is disabled/)
  assert.deepEqual(localCalls, [])
  assert.deepEqual(remoteCalls, [])
})

test('T4: spawn on an exec:on side workspace reaches the branch; relative argv[0] is not gated', () => {
  const store = sideStore()
  attachSides(store, [
    { id: 'sw-on', kind: 'remote', path: REMOTE_ROOT, exec: 'on' },
    { id: 'sw-off', kind: 'local', path: LOCAL_ROOT, exec: 'off' },
  ])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedSubprocessRuntime(stubProc('local', localCalls), stubProc('remote', remoteCalls) as never, () => store)

  assert.throws(() => mixed.spawn(spawnSpec('ssh://c1/srv/work', 'bash')), /branch reached: remote/)
  assert.deepEqual(remoteCalls, ['spawn:remote:cwd=ssh://c1/srv/work:argv0=bash'])

  // cwd OUTSIDE any side root + relative argv[0]: not attributable → passes (documented).
  assert.throws(() => mixed.spawn(spawnSpec(NEUTRAL_LOCAL_CWD, './run.sh')), /branch reached: local/)
  assert.deepEqual(localCalls, [`spawn:local:cwd=${NEUTRAL_LOCAL_CWD}:argv0=./run.sh`])
})

test('T4: spawnTerminal is gated the same way; no sides means no gating (R4 compat)', async () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-off', kind: 'remote', path: REMOTE_ROOT, exec: 'off' }])
  const remoteCalls: string[] = []
  const localCalls: string[] = []
  const tm = (cwd: string, argv0: string): SubprocessTerminalSpawnSpec => ({ argv: [argv0], cwd, cols: 80, rows: 24, graceMs: 1000, signal: new AbortController().signal })
  const mixedOff = new MixedSubprocessRuntime(stubProc('local', localCalls), stubProc('remote', remoteCalls) as never, () => store)
  await assert.rejects(() => mixedOff.spawnTerminal(tm('ssh://c1/srv/work', 'bash')), /execution is disabled/)
  assert.deepEqual(remoteCalls, [])

  // No sides (undefined): R4 behavior — local cwd reaches the local branch.
  const mixedNone = new MixedSubprocessRuntime(stubProc('local', localCalls), stubProc('remote', remoteCalls) as never)
  await assert.rejects(() => mixedNone.spawnTerminal(tm(LOCAL_ROOT, 'pwsh')), /branch reached: local/)
  assert.deepEqual(localCalls, [`terminal:local:cwd=${LOCAL_ROOT}:argv0=pwsh`])
})

/* ------------------------- 6) t2 修复：真实拼写下的门（占位树 cwd/key） */

test('t2-fix: exec gate DENIES a spawn whose cwd is the PLACEHOLDER spelling of an exec:off remote root', () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-x', kind: 'remote', path: REMOTE_ROOT, exec: 'off' }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedSubprocessRuntime(stubProc('local', localCalls), stubProc('remote', remoteCalls) as never, () => store)
  // A remote session's spawn cwd is <dshHome>/dsw-routes/c1/srv/work — the gate
  // must see it as the remote side root.
  assert.throws(() => mixed.spawn(spawnSpec(join(sshRoutesRoot(), 'c1', 'srv', 'work'), 'bash')), /execution is disabled/)
  assert.throws(() => mixed.spawn(spawnSpec(NEUTRAL_LOCAL_CWD, join(sshRoutesRoot(), 'c1', 'srv', 'work', 'run.sh'))), /execution is disabled/)
  assert.deepEqual(localCalls, [])
  assert.deepEqual(remoteCalls, [])
})

test('t2-fix: fs write gate DENIES a PLACEHOLDER-spelled target under a fs:r remote root', async () => {
  const store = sideStore()
  attachSides(store, [{ id: 'sw-ro', kind: 'remote', path: REMOTE_ROOT, fs: 'r' }])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)
  const placeholderTarget = {
    targetKey: FsTargetKey(join(sshRoutesRoot(), 'c1', 'srv', 'work', 'f.txt')),
    displayPath: join(sshRoutesRoot(), 'c1', 'srv', 'work', 'f.txt'),
  }
  await assert.rejects(
    () => mixed.writeText(placeholderTarget, 'x'),
    (error: unknown) => error instanceof FsError && error.code === 'FS_PERMISSION_DENIED',
  )
  assert.deepEqual(remoteCalls, [])
  assert.deepEqual(localCalls, [])
})

/* ------------------------------------- 4) 最长侧根与继承（双层侧根） */

test('T2: nested side roots — the INNER root wins for resolve routing too', async () => {
  const store = sideStore()
  const inner = join(LOCAL_ROOT, 'inner')
  attachSides(store, [
    { id: 'sw-out', kind: 'local', path: LOCAL_ROOT },
    { id: 'sw-in', kind: 'local', path: inner },
  ])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)
  const target = await mixed.resolve(join(inner, 'deep.txt'), { cwd: REMOTE_CWD })
  assert.equal(String(target.targetKey), resolve(join(inner, 'deep.txt'))) // local branch (inner is local)
  assert.deepEqual(localCalls, [`resolve:local:${JSON.stringify(join(inner, 'deep.txt'))}`])
})
