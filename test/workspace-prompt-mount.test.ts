/**
 * REQ-I6 ② + REQ-I11 的**整体接线**回归：真实挂载 `registerWorkspaceTools`（`sw_status` /
 * `sw_connect` + `sw-remote` section + `dsw-session-workspace` runtime context；`sw_exec` /
 * `tool:bash` 由 exec-tools 另挂），按会话上下文逐段求值，断言验收原句：
 *
 *   「本地会话系统提示不出现本插件文案；远程会话文案全英文且仅在远程事实成立时出现」
 *
 * REQ-I11（ADR-0021 §2.8）把提示拆成两段：
 * - **稳定框架**（远程强调 + AUDIT-6 诚实句）在 `section('sw-remote')`；
 * - **易变状态**（本会话已连接机器清单 + 副根清单）在
 *   `systemPrompt.context('dsw-session-workspace')`——每次 assembly 求值、以耐久
 *   user-role 快照进入对话，所以 `sw_connect`/面板的改动在**同一会话**里可见。
 * 两段都必须「无远程事实 ⇒ 空串」，即本地零连接会话零注入。
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
import type { SessionConnectionsFace } from '../src/session-remote-context.ts'
import type { SessionSideWorkspaceStore, SideWorkspaceItem } from '../src/session-workspaces.ts'
import { registerWorkspaceTools } from '../src/tools.ts'
import { sshRoutesRoot } from '../src/transport.ts'

interface CapturedEntry {
  name: string
  order: number
  text: unknown
}

interface Mounted {
  sections: CapturedEntry[]
  contexts: CapturedEntry[]
  toolNames: string[]
}

interface MountOptions {
  /** The side-workspace store accessor (absent ⇒ no attachments). */
  sides?: () => SessionSideWorkspaceStore | undefined
  /** The connected-machine store accessor (absent ⇒ no session connections). */
  connections?: () => SessionConnectionsFace | undefined
}

/** Mount the whole workspace tool surface on a fake host context. */
function mount(options: MountOptions = {}): Mounted {
  const sections: CapturedEntry[] = []
  const contexts: CapturedEntry[] = []
  const toolNames: string[] = []
  const registry = (): SshRegistry => ({
    // `c1` is registered: the implicit-main-machine union of REQ-I11 validates
    // the cwd route against the registry before trusting it.
    get: (id: string) => (id === 'c1'
      ? { id, endpoint: 'root@10.0.0.5', spec: { id, host: '10.0.0.5', port: 22, username: 'root' } }
      : undefined),
    getActive: () => null,
    listMachines: () => ({ machines: [{ id: 'c1', username: 'root', host: '10.0.0.5' }], currentId: null }),
  }) as unknown as SshRegistry
  const ctx = {
    // No `settings` service → hostLocaleOf falls back to en (the normal case).
    // `sessionConnections`/`sideWorkspaces` are optional services for the tools;
    // the accessors under test are passed in explicitly.
    get: () => undefined,
    tools: { register: (definition: { name: string }) => { toolNames.push(definition.name); return () => {} } },
    systemPrompt: {
      section: (section: CapturedEntry) => { sections.push(section); return () => {} },
      context: (context: CapturedEntry) => { contexts.push(context); return () => {} },
    },
    effect: () => {},
  }
  registerWorkspaceTools(
    ctx as unknown as Context,
    registry,
    options.sides ?? (() => undefined),
    options.connections ?? (() => undefined),
  )
  return { sections, contexts, toolNames }
}

/** The assembly context face the text providers read: `{ scope: agent }`. */
function assemblyContext(cwd: string | undefined, sessionId: string): { scope: object } {
  return {
    scope: {
      id: sessionId,
      session: { header: { ...(cwd !== undefined ? { cwd } : {}), id: sessionId } },
    },
  }
}

function textOf(entry: CapturedEntry, context: { scope?: object }): string {
  const provider = entry.text
  return typeof provider === 'function' ? (provider as (c: { scope?: object }) => string)(context) : String(provider)
}

function sideItem(): SideWorkspaceItem {
  return { id: 'sw-1', kind: 'local', rootKey: join(sshRoutesRoot(), '..', 'side'), label: 'side' }
}

function sideStore(): () => SessionSideWorkspaceStore {
  return () => ({ listFor: (id: string) => (id === 's1' ? [sideItem()] : []) }) as unknown as SessionSideWorkspaceStore
}

/** A read-only store double: session `s1` has `c1` connected, others have none. */
function connStore(byId: Record<string, string[]>): () => SessionConnectionsFace {
  const listFor = (id: string): readonly string[] => byId[id] ?? []
  return () => ({
    listFor,
    set: () => [],
    connect: () => [],
    disconnect: () => false,
  }) as unknown as SessionConnectionsFace
}
/** Every non-empty text one registration surface would inject for one session. */
function injectedTexts(entries: CapturedEntry[], context: { scope?: object }): string[] {
  return entries.map(entry => textOf(entry, context)).filter(text => text !== '')
}

/** The sections every host gets; `tool:bash` is win32-only (official bash owns it on POSIX). */
const BASE_SECTIONS = ['sw-remote', 'tool:sw-exec']
const EXPECTED_SECTIONS = process.platform === 'win32' ? [...BASE_SECTIONS, 'tool:bash'] : BASE_SECTIONS

test('mount: sw_status and sw_connect are always registered (tools are not session-scoped)', () => {
  const mounted = mount()
  for (const name of ['sw_status', 'sw_connect']) {
    assert.ok(mounted.toolNames.includes(name), `${name} must always be registered`)
  }
  assert.equal(mounted.toolNames.includes('sw_pick_workspace'), false)
})

test('mount: the volatile-state contribution is registered as dsw-session-workspace', () => {
  const mounted = mount()
  assert.deepEqual(mounted.contexts.map(context => context.name), ['dsw-session-workspace'])
  assert.equal(mounted.contexts[0]?.order, 90)
})

test('mount: a LOCAL session (no route, no side workspace, no connection) gets ZERO plugin text', () => {
  const mounted = mount()
  assert.deepEqual(mounted.sections.map(section => section.name).sort(), [...EXPECTED_SECTIONS].sort())
  const local = assemblyContext('C:\\Users\\me\\proj', 's1')
  assert.deepEqual(injectedTexts(mounted.sections, local), [])
  // REQ-I11: the runtime-context contribution is silent too — this is the
  // zero-injection rule on the connection axis.
  assert.deepEqual(injectedTexts(mounted.contexts, local), [])
  // A session whose cwd is simply missing is local too.
  assert.deepEqual(injectedTexts(mounted.sections, assemblyContext(undefined, 's1')), [])
  assert.deepEqual(injectedTexts(mounted.contexts, assemblyContext(undefined, 's1')), [])
})

test('mount: a REMOTE session gets every section, in English only', () => {
  const mounted = mount()
  const texts = injectedTexts(mounted.sections, assemblyContext('ssh://c1/srv/work', 's1'))
  assert.equal(texts.length, EXPECTED_SECTIONS.length,
    `expected ${EXPECTED_SECTIONS.join(' + ')}, got ${String(texts.length)} non-empty section(s)`)
  const joined = texts.join('\n')
  assert.ok(joined.includes('remote SSH workspace'))
  assert.ok(joined.includes('sw_exec executes a command on the specified server'))
  if (process.platform === 'win32') {
    assert.ok(joined.includes('The bash tool runs `bash -c` on this session\'s remote Linux workspace'))
  }
  // No Chinese may reach the model on any of the three surfaces.
  assert.ok(!/[\p{Script=Han}]/u.test(joined), `model-facing text must be English only: ${joined}`)
  // REQ-I11 §2.8: the stable section carries the FRAMING only — the volatile
  // lists live in the runtime context. Here that context carries exactly the
  // implicit main machine (`c1`, the cwd's route) and nothing else.
  assert.ok(!joined.includes('Machines connected to this session'))
  assert.ok(!joined.includes('Side workspace'))
  const contextTexts = injectedTexts(mounted.contexts, assemblyContext('ssh://c1/srv/work', 's1'))
  assert.equal(contextTexts.length, 1)
  assert.ok(contextTexts[0]?.includes('- `c1` — root@10.0.0.5'), contextTexts[0])
})

test('mount: a side workspace alone (local cwd) renders through the runtime context', () => {
  const mounted = mount({ sides: sideStore() })
  const local = assemblyContext('C:\\Users\\me\\proj', 's1')
  // The stable framing stays silent for a local cwd (no remote route)...
  const swRemote = mounted.sections.find(section => section.name === 'sw-remote')
  assert.ok(swRemote !== undefined)
  assert.equal(textOf(swRemote, local), '')
  // ...while the volatile list is the single place the side root is rendered.
  const injected = injectedTexts(mounted.contexts, local)
  assert.equal(injected.length, 1)
  assert.equal(injected[0]?.split('Side workspace **side**').length, 2)
  assert.equal(injected[0]?.split('Extra workspaces linked to this session').length, 2)
  // `tool:sw-exec` still turns on for a side-root session (REQ-I6 ② axis).
  const swExec = mounted.sections.find(section => section.name === 'tool:sw-exec')
  assert.ok(swExec !== undefined)
  assert.notEqual(textOf(swExec, local), '')
  // A different session without attachments stays silent.
  assert.deepEqual(injectedTexts(mounted.contexts, assemblyContext('C:\\Users\\me\\proj', 's2')), [])
  assert.deepEqual(injectedTexts(mounted.sections, assemblyContext('C:\\Users\\me\\proj', 's2')), [])
})

test('mount: a connected machine alone (local cwd, no side root) turns the remote world on', () => {
  const mounted = mount({ connections: connStore({ s1: ['c1'] }) })
  const local = assemblyContext('C:\\Users\\me\\proj', 's1')
  // REQ-I11: ≥1 connected machine is a remote fact for the tool prompt gate.
  const swExec = mounted.sections.find(section => section.name === 'tool:sw-exec')
  assert.ok(swExec !== undefined)
  assert.notEqual(textOf(swExec, local), '')
  // The connection list is rendered by the runtime context exactly once.
  const injected = injectedTexts(mounted.contexts, local)
  assert.equal(injected.length, 1)
  assert.equal(injected[0]?.split('Machines connected to this session').length, 2)
  assert.ok(injected[0]?.includes('`c1`'))
  // A session with no connection keeps zero injection on both surfaces.
  assert.deepEqual(injectedTexts(mounted.contexts, assemblyContext('C:\\Users\\me\\proj', 's2')), [])
})

test('mount: a REMOTE session lists the main machine once (context), never twice', () => {
  const mounted = mount({ connections: connStore({ s1: ['c2'] }) })
  const remote = assemblyContext('ssh://c1/srv/work', 's1')
  const contexts = injectedTexts(mounted.contexts, remote)
  assert.equal(contexts.length, 1)
  // Implicit main machine first, then the stored set.
  const list = contexts[0] ?? ''
  assert.ok(list.includes('`c1`'))
  assert.ok(list.includes('`c2`'))
  assert.ok(list.indexOf('`c1`') < list.indexOf('`c2`'))
  const sections = injectedTexts(mounted.sections, remote).join('\n')
  assert.ok(!sections.includes('Machines connected to this session'),
    'the machine list must not be duplicated in the stable section')
})
