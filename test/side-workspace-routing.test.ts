/**
 * R5 T2 → REQ-I7 单测：侧工作区（副目录）在混合门面上的**路由**行为 ——
 * resolve/lstat 按「路径命中侧根」路由（即使 cwd 在另一个世界）、
 * 最长前缀匹配下嵌套内根获胜、写操作按 targetKey 路由
 * （REQ-I7 起 side 根只是声明，无任何门）。
 * 侧根数据用真实 SessionSideWorkspaceStore（临时文件）驱动。
 *
 * 权限门（fs 写门 / exec 门）已随 REQ-I7（ADR-0019）整体退役；
 * 纯前缀匹配语义（含占位树/连接点拼写归一）另见 test/session-workspaces.test.ts。
 * @module test/side-workspace-routing
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { MixedFileSystem } from '../src/mixed.ts'
import type { FileSystemBranch } from '../src/mixed.ts'
import { SessionSideWorkspaceStore } from '../src/session-workspaces.ts'

const LOCAL_ROOT = resolve(tmpdir(), 'dsw-side', 'local-proj')
const REMOTE_ROOT = 'ssh://c1/srv/work'
const REMOTE_CWD = 'ssh://c1/srv/work' // remote-spelled main cwd (worldOfCwd → remote)

function sideStore(): SessionSideWorkspaceStore {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sideg-'))
  return new SessionSideWorkspaceStore(new Context(), { file: join(dir, 's.json') })
}

/* --------------------------------------------------- fs 分支替身 */

/**
 * A COMPLETE `FileSystemBranch` stub (all seam methods, including the two the
 * contract grew later — `processPathFromHostPath` and `readByteRange`), so the
 * literal keeps its shape even though tests are outside `tsc`'s include set
 * (the AUDIT-3 lesson).
 */
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
    processPathFromHostPath(hostPath: string): string | undefined {
      calls.push(`processPathFromHostPath:${label}`)
      return resolve(hostPath)
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
    async readByteRange(): Promise<Uint8Array> {
      calls.push(`readByteRange:${label}`)
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
function attachSides(store: SessionSideWorkspaceStore, presets: Array<{ id: string; kind: 'local' | 'remote'; path: string }>): void {
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

/* ------------------------------------- 3) 最长侧根与继承（双层侧根） */

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

/* ------------------------- 3) REQ-I7：写操作纯按 targetKey 路由（无门） */

test('REQ-I7: writeText/editText route by target key with NO gate on side roots', async () => {
  const store = sideStore()
  attachSides(store, [
    { id: 'sw-r', kind: 'remote', path: REMOTE_ROOT },
    { id: 'sw-l', kind: 'local', path: LOCAL_ROOT },
  ])
  const localCalls: string[] = []
  const remoteCalls: string[] = []
  const mixed = new MixedFileSystem(stubFs('local', localCalls), stubFs('remote', remoteCalls) as never, () => store)
  const remoteTarget = { targetKey: FsTargetKey('ssh://c1/srv/work/ok.txt'), displayPath: 'ssh://c1/srv/work/ok.txt' }
  const localTarget = { targetKey: FsTargetKey(resolve(LOCAL_ROOT, 'f.txt')), displayPath: resolve(LOCAL_ROOT, 'f.txt') }

  // Every write under a side root REACHES the owning branch — the declaration
  // no longer restricts anything (ADR-0019).
  await assert.rejects(() => mixed.writeText(remoteTarget, 'x'), /branch reached: remote/)
  await assert.rejects(() => mixed.editText(remoteTarget, { oldString: 'a', newString: 'b' }), /branch reached: remote/)
  await assert.rejects(() => mixed.writeText(localTarget, 'x'), /branch reached: local/)
  assert.deepEqual(remoteCalls, ['writeText:remote', 'editText:remote'])
  assert.deepEqual(localCalls, ['writeText:local'])
})
