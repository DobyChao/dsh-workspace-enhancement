/**
 * REQ-I6 ② 的**整体接线**回归：真实挂载 `registerWorkspaceTools`（三个 sw_* 工具 +
 * `sw-remote` section + `tool:sw-exec` / `tool:bash` 两段），按会话上下文逐段求值，
 * 断言验收原句：
 *
 *   「本地会话系统提示不出现本插件文案；远程会话文案全英文且仅在远程事实成立时出现」
 *
 * 与 `test/prompt-injection.test.ts` 的区别：那份只挂 `exec-tools` 的两段并逐个
 * 判定纯函数；这份把**整个插件行的宿主注册路径**跑一遍（含 `sw-remote` 的组合逻辑），
 * 是本条需求最容易在集成处回退的地方。
 * @module test/workspace-prompt-mount
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SshRegistry } from '../src/registry.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from '../src/session-workspaces.ts'
import { registerWorkspaceTools } from '../src/tools.ts'
import { sshRoutesRoot } from '../src/transport.ts'

interface CapturedSection {
  name: string
  order: number
  text: unknown
}

interface Mounted {
  sections: CapturedSection[]
  toolNames: string[]
}

/** Mount the whole workspace tool surface on a fake host context. */
function mount(sides?: () => SessionSideWorkspaceStore | undefined): Mounted {
  const sections: CapturedSection[] = []
  const toolNames: string[] = []
  const registry = (): SshRegistry => ({
    get: () => undefined,
    getActive: () => null,
    listMachines: () => ({ machines: [{ id: 'c1' }], currentId: null }),
  }) as unknown as SshRegistry
  const ctx = {
    // No `settings` service → hostLocaleOf falls back to en (the normal case).
    get: () => undefined,
    tools: { register: (definition: { name: string }) => { toolNames.push(definition.name); return () => {} } },
    systemPrompt: { section: (section: CapturedSection) => { sections.push(section); return () => {} } },
    effect: () => {},
  }
  registerWorkspaceTools(ctx as unknown as Context, registry, sides)
  return { sections, toolNames }
}

/** The assembly context face the section text providers read: `{ scope: agent }`. */
function assemblyContext(cwd: string | undefined, sessionId: string): { scope: object } {
  return {
    scope: {
      id: sessionId,
      session: { header: { ...(cwd !== undefined ? { cwd } : {}), id: sessionId } },
    },
  }
}

function textOf(section: CapturedSection, context: { scope?: object }): string {
  const provider = section.text
  return typeof provider === 'function' ? (provider as (c: { scope?: object }) => string)(context) : String(provider)
}

function sideItem(): SideWorkspaceItem {
  return { id: 'sw-1', kind: 'local', rootKey: join(sshRoutesRoot(), '..', 'side'), label: 'side', fs: 'rw', exec: 'on' }
}

function sideStore(): () => SessionSideWorkspaceStore {
  return () => ({ listFor: (id: string) => (id === 's1' ? [sideItem()] : []) }) as unknown as SessionSideWorkspaceStore
}

/** Every non-empty model-facing text the mount would inject for one session. */
function injectedTexts(mounted: Mounted, context: { scope?: object }): string[] {
  return mounted.sections.map(section => textOf(section, context)).filter(text => text !== '')
}

/** The sections every host gets; `tool:bash` is win32-only (official bash owns it on POSIX). */
const BASE_SECTIONS = ['sw-remote', 'tool:sw-exec']
const EXPECTED_SECTIONS = process.platform === 'win32' ? [...BASE_SECTIONS, 'tool:bash'] : BASE_SECTIONS

test('mount: the three sw_* tools are always registered (tools are not session-scoped)', () => {
  const mounted = mount()
  for (const name of ['sw_status', 'sw_connect', 'sw_pick_workspace']) {
    assert.ok(mounted.toolNames.includes(name), `${name} must always be registered`)
  }
})

test('mount: a LOCAL session (no route, no side workspace) gets ZERO plugin prompt text', () => {
  const mounted = mount()
  assert.deepEqual(mounted.sections.map(section => section.name).sort(), [...EXPECTED_SECTIONS].sort())
  assert.deepEqual(injectedTexts(mounted, assemblyContext('C:\\Users\\me\\proj', 's1')), [])
  // A session whose cwd is simply missing is local too.
  assert.deepEqual(injectedTexts(mounted, assemblyContext(undefined, 's1')), [])
})

test('mount: a REMOTE session gets every section, in English only', () => {
  const mounted = mount()
  const texts = injectedTexts(mounted, assemblyContext('ssh://c1/srv/work', 's1'))
  assert.equal(texts.length, EXPECTED_SECTIONS.length,
    `expected ${EXPECTED_SECTIONS.join(' + ')}, got ${String(texts.length)} non-empty section(s)`)
  const joined = texts.join('\n')
  assert.ok(joined.includes('remote SSH workspace'))
  assert.ok(joined.includes('sw_exec executes a command on the specified server'))
  if (process.platform === 'win32') {
    assert.ok(joined.includes('The bash tool targets remote Linux workspaces'))
  }
  // No Chinese may reach the model on any of the three surfaces.
  assert.ok(!/[\p{Script=Han}]/u.test(joined), `model-facing text must be English only: ${joined}`)
})

test('mount: a side workspace alone (local cwd) turns the remote world on for every section', () => {
  const mounted = mount(sideStore())
  const texts = injectedTexts(mounted, assemblyContext('C:\\Users\\me\\proj', 's1'))
  assert.equal(texts.length, EXPECTED_SECTIONS.length)
  assert.ok(texts.join('\n').includes('Side workspace **side**'))
  // A different session without attachments stays silent.
  assert.deepEqual(injectedTexts(mounted, assemblyContext('C:\\Users\\me\\proj', 's2')), [])
})
