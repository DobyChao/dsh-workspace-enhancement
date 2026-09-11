/**
 * REQ-I6 ② 单测：按工作区状态**按需注入**。
 *
 * 判定面（`hasRemoteWorkspaceContext` / `sessionWorkspaceContextOf`）与会话
 * 事实读取是纯函数；三段 model-facing section 的 `text(context)` 契约在此
 * 直接调用验证（不需要起真实 assembly）：
 * - 本地会话（cwd 非路由、无副工作区）→ `sw-remote` / `tool:sw-exec` /
 *   `tool:bash` 三段全部零注入；
 * - 远程会话（cwd = `ssh://<id>/…` 或占位树）→ 三段都出现，且全英文；
 * - 只有副工作区、cwd 是本地 → 同样视为「远程世界」（副目录可远程）→ 注入。
 *
 * 与 `test/exec-tools.test.ts` 的注册用例互补：那里验证「注册了什么」，
 * 这里验证「在什么会话状态下真的注入了文字」。
 * @module test/prompt-injection
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { registerSwExec, registerWin32Bash } from '../src/exec-tools.ts'
import type { SwExecConnection } from '../src/exec-tools.ts'
import type { SshRegistry } from '../src/registry.ts'
import type { SshConnectionSpec } from '../src/connection.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from '../src/session-workspaces.ts'
import { sshRoutesRoot } from '../src/transport.ts'
import { hasRemoteWorkspaceContext, sessionWorkspaceContextOf } from '../src/session-remote-context.ts'

/* --------------------------------------------------------------- 测试替身 */

interface CapturedSection {
  name: string
  order: number
  text: unknown
}

/** A tool context that captures sections (tools/effects are stubs). */
function fakeToolContext(): {
  ctx: Context
  sections: CapturedSection[]
} {
  const sections: CapturedSection[] = []
  const ctx = {
    get: () => undefined,
    tools: { register: () => () => {} },
    systemPrompt: { section: (section: CapturedSection) => { sections.push(section); return () => {} } },
    effect: () => {},
  }
  return { ctx: ctx as unknown as Context, sections }
}

function baseSpec(id: string, host: string, username: string): SshConnectionSpec {
  return { id, host, port: 22, username } as unknown as SshConnectionSpec
}

function fakeConnection(): SwExecConnection {
  return {
    id: 'c1',
    endpoint: 'root@10.0.0.5',
    spec: baseSpec('c1', '10.0.0.5', 'root'),
    exec: async () => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
  }
}

function fakeRegistry(): () => SshRegistry {
  return () => ({
    get: () => undefined,
    getActive: () => null,
    listMachines: () => ({ machines: [{ id: 'c1' }], currentId: null }),
  }) as unknown as SshRegistry
}

/** A minimal side-workspace store exposing only `listFor`. */
function fakeSideStore(items: Record<string, SideWorkspaceItem[]>): () => SessionSideWorkspaceStore {
  return () => ({ listFor: (sessionId: string) => items[sessionId] ?? [] }) as unknown as SessionSideWorkspaceStore
}

/** The assembly context face the section text providers read: `{ scope: agent }`. */
function assemblyContext(cwd: string | undefined, sessionId: string | undefined): { scope: object } {
  return { scope: { id: sessionId ?? 'agent', session: { header: { ...(cwd !== undefined ? { cwd } : {}), ...(sessionId !== undefined ? { id: sessionId } : {}) } } } }
}

function sideItem(over: Partial<SideWorkspaceItem> = {}): SideWorkspaceItem {
  return { id: 'sw-1', kind: 'local', rootKey: join(sshRoutesRoot(), '..', 'side-proj'), label: 'side', ...over }
}

/** Render one captured section's text for a given assembly context. */
function textOf(section: CapturedSection | undefined, context: { scope?: object }): string {
  assert.ok(section !== undefined, 'section must be registered')
  const provider = section.text
  return typeof provider === 'function' ? (provider as (c: { scope?: object }) => string)(context) : String(provider)
}

/* ---------------------------------------------- 1) 会话事实与注入判定（纯） */

test('sessionWorkspaceContextOf: leaf facts only — cwd, sessionId, attached sides', () => {
  const store = fakeSideStore({ s1: [sideItem()] })
  assert.deepEqual(sessionWorkspaceContextOf(assemblyContext('ssh://c1/srv', 's1'), store), {
    cwd: 'ssh://c1/srv',
    sessionId: 's1',
    sides: [sideItem()],
  })
  // No scope carrier at all → empty facts, never a throw.
  assert.deepEqual(sessionWorkspaceContextOf({}, store), { sides: [] })
  // No store accessor → no attachments (the plugin row may mount without it).
  assert.deepEqual(sessionWorkspaceContextOf(assemblyContext('ssh://c1/srv', 's1')), {
    cwd: 'ssh://c1/srv',
    sessionId: 's1',
    sides: [],
  })
})

test('hasRemoteWorkspaceContext: local cwd without attachments is false; remote route or a side workspace is true', () => {
  const store = fakeSideStore({ s1: [sideItem()] })
  assert.equal(hasRemoteWorkspaceContext(assemblyContext('C:\\Users\\me\\proj', 's1')), false)
  assert.equal(hasRemoteWorkspaceContext(assemblyContext(undefined, 's1')), false)
  assert.equal(hasRemoteWorkspaceContext({}), false)
  assert.equal(hasRemoteWorkspaceContext(assemblyContext('ssh://c1/srv', 's1')), true)
  assert.equal(hasRemoteWorkspaceContext(assemblyContext(join(sshRoutesRoot(), 'c1', 'srv'), 's1')), true)
  // A local session that merely CONTAINS the placeholder tree is not a route.
  assert.equal(hasRemoteWorkspaceContext(assemblyContext(join(sshRoutesRoot(), '..', 'elsewhere'), 's1')), false)
  // Local cwd + an attached side workspace still counts as the remote world.
  assert.equal(hasRemoteWorkspaceContext(assemblyContext('C:\\Users\\me\\proj', 's1'), store), true)
})

/* ------------------------------------------------- 2) tool:sw-exec 注入判定 */

test('tool:sw-exec section: zero injection for a local session, English text once remote', () => {
  const fake = fakeToolContext()
  registerSwExec(fake.ctx, fakeRegistry())
  const section = fake.sections.find(entry => entry.name === 'tool:sw-exec')
  assert.equal(textOf(section, assemblyContext('C:\\Users\\me\\proj', 's1')), '')
  assert.equal(textOf(section, assemblyContext(undefined, 's1')), '')
  const remote = textOf(section, assemblyContext('ssh://c1/srv', 's1'))
  assert.ok(remote.startsWith('sw_exec executes a command on the specified server'))
  assert.ok(remote.includes('[exit code: N]'))
  assert.ok(!remote.includes('指定服务器'))
})

test('tool:sw-exec section: an attached side workspace alone is enough (local cwd)', () => {
  const fake = fakeToolContext()
  registerSwExec(fake.ctx, fakeRegistry(), { sides: fakeSideStore({ s1: [sideItem()] }) })
  const section = fake.sections.find(entry => entry.name === 'tool:sw-exec')
  assert.ok(textOf(section, assemblyContext('C:\\Users\\me\\proj', 's1')).includes('sw_exec executes a command'))
  // Another session without attachments stays clean.
  assert.equal(textOf(section, assemblyContext('C:\\Users\\me\\proj', 's2')), '')
})

/* ---------------------------------------------------- 3) tool:bash 注入判定 */

test('tool:bash section: win32 registers it; zero injection locally, English text once remote', () => {
  const fake = fakeToolContext()
  registerWin32Bash(fake.ctx, fakeRegistry(), { platform: 'win32' })
  const section = fake.sections.find(entry => entry.name === 'tool:bash')
  assert.equal(textOf(section, assemblyContext('C:\\Users\\me\\proj', 's1')), '')
  const remote = textOf(section, assemblyContext('ssh://c1/srv', 's1'))
  assert.ok(remote.startsWith('The bash tool targets remote Linux workspaces'))
  assert.ok(remote.includes('[exit code: N]'))
  assert.ok(!remote.includes('面向远程'))
})

test('tool:bash section: POSIX hosts stay a no-op (no section at all)', () => {
  const fake = fakeToolContext()
  registerWin32Bash(fake.ctx, fakeRegistry(), { platform: 'linux' })
  assert.deepEqual(fake.sections, [])
})

/* --------------------------------------------- 4) sw-remote 三段协同（英文） */

test('sw-remote + tool sections agree: a local session sees no plugin prompt text', () => {
  const fake = fakeToolContext()
  registerSwExec(fake.ctx, fakeRegistry())
  registerWin32Bash(fake.ctx, fakeRegistry(), { platform: 'win32' })
  const local = assemblyContext('C:\\Users\\me\\proj', 's1')
  const injected = fake.sections
    .map(section => textOf(section, local))
    .filter(text => text !== '')
  assert.deepEqual(injected, [], 'local session must get zero model-facing plugin text')
})
