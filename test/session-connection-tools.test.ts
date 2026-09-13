/**
 * REQ-I11（ADR-0021 §2.2/§2.4/§2.5）单测：会话级机器连接的工具面与执行门。
 *
 * 覆盖：
 * 1. 可达性探测（`probeMachine`/`probeMachines`，有界、纯数据结果）；
 * 2. `sw_connect(machines: [])` 清空本会话连接；
 * 3. 未知 id 报错并列出已知 id，且不动存储；
 * 4. 部分不可达：可达者入库、不可达者如实报告且不入库；
 * 5. 全部不可达：抛错且**存储不变**（原子性）；
 * 6. 会话 id 无法解析：fail closed（不改存储 / 拒绝执行）；
 * 7. `sw_connect` 参数面只允许 `machines`（SEC-5：凭据永不作为模型工具参数）；
 * 8. `sw_status` 的「本会话已连接机器」一行；
 * 9. 隐式主机器（cwd 路由）视为已连接，读取时并集、不写回；
 * 10. `sw_exec` 会话门：无连接拒绝、已注册未连接报错并列出已连接 id、
 *     未知 id 保持既有「未知服务器」文案、隐式主机器放行；
 * 11. 提示面：`dsw-session-workspace` 运行时上下文贡献（ADR-0021 §2.8）
 *     对本地零连接会话返回空串，否则列出已连接机器 + 副根。
 *
 * 纯函数直接测；工具面用假 ctx + 假注册表跑 `execute`（无网络、无真 SSH）。
 * @module test/session-connection-tools
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ExecOutcome } from '../src/ssh-core.ts'
import {
  MACHINE_PROBE_TIMEOUT_MS,
  connectedMachinesOf,
  probeMachine,
  probeMachines,
  registerSwExec,
  requireConnectedServer,
} from '../src/exec-tools.ts'
import type { ProbeRegistryFace } from '../src/exec-tools.ts'
import { connectedMachineFact, registerWorkspaceTools, renderSessionWorkspaceContext } from '../src/tools.ts'
import type { SessionConnectionsFace } from '../src/session-remote-context.ts'
import { sshRoutesRoot } from '../src/transport.ts'

/* --------------------------------------------------------------- 测试替身 */

const SESSION = 's1'

/** Minimal connection spec double (the fields the tool layer reads). */
function specOf(id: string): Record<string, unknown> {
  const row = MACHINE_TABLE.find(machine => machine.id === id)
  return {
    id,
    label: id,
    host: row?.host ?? '10.0.0.9',
    port: 22,
    username: row?.username ?? 'root',
    workspace: row?.workspace ?? `/srv/${id}`,
  }
}

/**
 * One live-connection double: reachable unless `failure` is set. Carries the
 * `spec`/`endpoint` leaves `resolveSwExecServer`/`defaultRemoteDir` read.
 */
function conn(id: string, failure?: string): {
  id: string
  endpoint: string
  spec: Record<string, unknown>
  exec: (command: string) => Promise<ExecOutcome>
} {
  return {
    id,
    endpoint: `${String(specOf(id).username)}@${String(specOf(id).host)}`,
    spec: specOf(id),
    exec: async (): Promise<ExecOutcome> => {
      if (failure !== undefined) throw new Error(failure)
      return { exitCode: 0, signal: null, stdout: 'ok\n', stderr: '' }
    },
  }
}

/** A registry double over a fixed machine table (id → live connection). */
function registryOf(machines: Record<string, ReturnType<typeof conn>>): ProbeRegistryFace {
  return { get: (id: string) => machines[id] }
}

/** The machine table the fake `SshRegistry` reports (id + endpoint facts). */
const MACHINE_TABLE = [
  { id: 'c1', label: 'c1', host: '10.0.0.5', port: 22, username: 'root', workspace: '/srv/c1' },
  { id: 'c2', label: 'c2', host: '10.0.0.6', port: 22, username: 'dev', workspace: '/srv/c2' },
]

/** A fake `SshRegistry` for the tool layer (only the used methods exist). */
function fakeRegistry(overrides: Record<string, unknown> = {}): unknown {
  return {
    listMachines: () => ({ machines: MACHINE_TABLE, currentId: null }),
    // `sw_status` renders the whole registry snapshot.
    status: () => ({
      host: '10.0.0.5', port: 22, username: 'root', connected: false, workspace: '/srv/c1',
      currentId: 'c1', activeSource: 'machine', hostKeyMode: 'accept-new', hostKeyKnown: false,
      hostKeyEntry: null, machines: MACHINE_TABLE, backend: 'plain',
    }),
    getActive: () => null,
    get: (id: string) => (id === 'c1' || id === 'c2' ? conn(id) : undefined),
    ...overrides,
  }
}

/** An in-memory `SessionMachineConnections` double. */
class FakeStore {
  readonly sessions = new Map<string, string[]>()

  listFor(sessionId: string): readonly string[] {
    return [...(this.sessions.get(sessionId) ?? [])]
  }

  set(sessionId: string, ids: readonly unknown[]): string[] {
    const list = ids.map(id => String(id)).filter(id => id !== '')
    if (list.length === 0) this.sessions.delete(sessionId)
    else this.sessions.set(sessionId, list)
    return [...list]
  }

  connect(sessionId: string, id: string): string[] {
    const kept = this.listFor(sessionId).filter(entry => entry !== id)
    this.sessions.set(sessionId, [...kept, id])
    return [...this.listFor(sessionId)]
  }

  disconnect(sessionId: string, id: string): boolean {
    const list = this.listFor(sessionId)
    if (!list.includes(id)) return false
    this.set(sessionId, list.filter(entry => entry !== id))
    return true
  }
}

/** A read-only store face for a fixed session→ids map. */
function readOnlyStore(byId: Record<string, string[]>): SessionConnectionsFace {
  return {
    listFor: (sessionId: string) => byId[sessionId] ?? [],
    set: () => [],
    connect: () => [],
    disconnect: () => false,
  }
}

/** One captured fake host context. */
interface FakeCtx {
  ctx: Context
  tools: ToolDefinition[]
  sections: Array<{ name: string; text: unknown }>
  contexts: Array<{ name: string; text: unknown }>
}

/**
 * Build the fake host context the tools register against.
 * @param subprocessError - when set, `ctx.get('subprocess')` throws it: the
 *   marker that proves routing did NOT reach the spawn seam.
 */
function fakeHostCtx(subprocessError?: string): FakeCtx {
  const tools: ToolDefinition[] = []
  const sections: Array<{ name: string; text: unknown }> = []
  const contexts: Array<{ name: string; text: unknown }> = []
  const ctx = {
    get: (name: string) => {
      if (name === 'subprocess' && subprocessError !== undefined) throw new Error(subprocessError)
      return undefined
    },
    tools: { register: (definition: ToolDefinition) => { tools.push(definition); return () => {} } },
    systemPrompt: {
      section: (section: { name: string; text: unknown }) => { sections.push(section); return () => {} },
      context: (context: { name: string; text: unknown }) => { contexts.push(context); return () => {} },
    },
    effect: () => {},
  }
  return { ctx: ctx as unknown as Context, tools, sections, contexts }
}

/** The `sw_connect` definition of one mount (throws when it is not registered). */
function toolOf(mounted: FakeCtx, name: string): ToolDefinition {
  const definition = mounted.tools.find(tool => tool.name === name)
  assert.ok(definition !== undefined, `${name} must be registered`)
  return definition
}

/** The run context the tools read (`agent` is the per-session scope carrier). */
interface RunContextFace {
  agent?: unknown
  signal: AbortSignal
}

/** Build one tool run context. */
function runContext(sessionId: string | undefined, cwd?: string): RunContextFace {
  const agent = sessionId === undefined
    ? {}
    : { id: sessionId, session: { header: { ...(cwd !== undefined ? { cwd } : {}), id: sessionId } } }
  return { agent, signal: new AbortController().signal }
}

/** `ToolDefinition.execute` is `(args: unknown, exec) => Promise<unknown>` on the wire. */
type ExecFn = (args: unknown, exec: unknown) => Promise<unknown>

/** Execute one tool and return its text value. */
async function runTool(definition: ToolDefinition, args: unknown, exec: RunContextFace): Promise<string> {
  const value = await (definition.execute as unknown as ExecFn)(args, exec)
  return (value as { text: string }).text
}

/** Mount `registerWorkspaceTools` over one store accessor. */
function mountWorkspaceTools(
  store: () => SessionConnectionsFace | undefined,
  registry: unknown = fakeRegistry(),
): FakeCtx {
  const mounted = fakeHostCtx()
  registerWorkspaceTools(mounted.ctx, () => registry as never, () => undefined, store)
  return mounted
}

/* ---------------------------------------------------- 1) 可达性探测（纯函数） */

test('probeMachine: reachable / unknown id / thrown error / non-zero exit are pure data', async () => {
  assert.equal(MACHINE_PROBE_TIMEOUT_MS, 8_000)
  const reachable = await probeMachine(registryOf({ c1: conn('c1') }), 'c1')
  assert.equal(reachable.id, 'c1')
  assert.equal(reachable.ok, true)
  assert.equal(reachable.detail, '')
  assert.ok(reachable.latencyMs >= 0)

  const missing = await probeMachine(registryOf({}), 'c9')
  assert.equal(missing.ok, false)
  assert.match(missing.detail, /unknown machine id "c9"/)

  const broken = await probeMachine(registryOf({ c1: conn('c1', 'connection reset') }), 'c1')
  assert.equal(broken.ok, false)
  assert.equal(broken.detail, 'connection reset')

  const nonZero = await probeMachine({
    get: () => ({ exec: async (): Promise<ExecOutcome> => ({ exitCode: 7, signal: null, stdout: '', stderr: 'boom' }) }),
  }, 'c1')
  assert.equal(nonZero.ok, false)
  assert.equal(nonZero.detail, 'boom')
})

test('probeMachines: the requested order is preserved (sequential, bounded each)', async () => {
  const results = await probeMachines(registryOf({ c1: conn('c1'), c2: conn('c2', 'down') }), ['c2', 'c1'])
  assert.deepEqual(results.map(result => [result.id, result.ok]), [['c2', false], ['c1', true]])
})

/* ------------------------------------------- 2) sw_connect：替换语义与原子性 */

test('sw_connect: `machines: []` clears the session connections', async () => {
  const store = new FakeStore()
  store.set(SESSION, ['c1', 'c2'])
  const mounted = mountWorkspaceTools(() => store as unknown as SessionConnectionsFace)
  const text = await runTool(toolOf(mounted, 'sw_connect'), { machines: [] }, runContext(SESSION))
  assert.equal(text, 'Disconnected every machine from this session.')
  assert.deepEqual(store.listFor(SESSION), [])
})

test('sw_connect: an unknown id errors with the known list and touches nothing', async () => {
  const store = new FakeStore()
  store.set(SESSION, ['c1'])
  const mounted = mountWorkspaceTools(() => store as unknown as SessionConnectionsFace)
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_connect'), { machines: ['c9'] }, runContext(SESSION)),
    /unknown machine id\(s\): c9 — known: c1, c2/,
  )
  assert.deepEqual(store.listFor(SESSION), ['c1'])
})

test('sw_connect: unreachable machines are reported and left out, reachable ones are stored', async () => {
  const store = new FakeStore()
  const mounted = mountWorkspaceTools(
    () => store as unknown as SessionConnectionsFace,
    fakeRegistry({ get: (id: string) => (id === 'c1' ? conn('c1') : conn(id, 'no route to host')) }),
  )
  const text = await runTool(toolOf(mounted, 'sw_connect'), { machines: ['c2', 'c1'] }, runContext(SESSION))
  assert.match(text, /^Machines connected to this session:/)
  assert.ok(text.includes('- c1 (root@10.0.0.5): reachable, connected'), text)
  assert.ok(text.includes('- c2: unreachable — no route to host (not connected)'), text)
  assert.deepEqual(store.listFor(SESSION), ['c1'])
})

test('sw_connect: all-unreachable THROWS and leaves the store unchanged (atomicity)', async () => {
  const store = new FakeStore()
  store.set(SESSION, ['c1'])
  const mounted = mountWorkspaceTools(
    () => store as unknown as SessionConnectionsFace,
    fakeRegistry({ get: (id: string) => conn(id, `${id} is down`) }),
  )
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_connect'), { machines: ['c1', 'c2'] }, runContext(SESSION)),
    (error: Error) => {
      assert.match(error.message, /^sw_connect: no requested machine was reachable/)
      assert.ok(error.message.includes('- c1: unreachable — c1 is down (not connected)'), error.message)
      assert.ok(error.message.includes('- c2: unreachable — c2 is down (not connected)'), error.message)
      return true
    },
  )
  assert.deepEqual(store.listFor(SESSION), ['c1'], 'a failed switch must never half-apply')
})

test('sw_connect: an unresolvable session id fails closed', async () => {
  const store = new FakeStore()
  const mounted = mountWorkspaceTools(() => store as unknown as SessionConnectionsFace)
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_connect'), { machines: ['c1'] }, runContext(undefined)),
    /cannot resolve this session id — refusing to change connection state/,
  )
  assert.deepEqual(store.listFor(SESSION), [])
})

test('sw_connect: the parameter face is exactly one required string array (SEC-5)', () => {
  const mounted = mountWorkspaceTools(() => undefined)
  const parameters = toolOf(mounted, 'sw_connect').parameters as {
    properties: Record<string, { type?: string; items?: { type?: string } }>
    required?: string[]
  }
  assert.deepEqual(Object.keys(parameters.properties), ['machines'])
  assert.equal(parameters.properties.machines?.type, 'array')
  assert.equal(parameters.properties.machines?.items?.type, 'string')
  assert.deepEqual(parameters.required, ['machines'])
  // No credential material may reappear on the model's parameter surface.
  for (const forbidden of ['password', 'passphrase', 'privateKeyPath', 'host', 'username', 'port', 'save']) {
    assert.equal(parameters.properties[forbidden], undefined, `${forbidden} must not be a tool parameter`)
  }
})

/* ------------------------------------------------------- 3) sw_status 连接行 */

test('sw_status: prints the session connected machines (ids + endpoint), or the none text', async () => {
  const store = new FakeStore()
  store.set(SESSION, ['c2'])
  const mounted = mountWorkspaceTools(() => store as unknown as SessionConnectionsFace)
  const text = await runTool(toolOf(mounted, 'sw_status'), {}, runContext(SESSION))
  assert.ok(text.includes('Machines connected to this session: c2 (dev@10.0.0.6)'), text)
  // The registry-wide facts survive the addition (REQ-I11 keeps them all).
  assert.ok(text.includes('Remote host:'), text)
  assert.ok(text.includes('Host key:'), text)
  const none = await runTool(toolOf(mounted, 'sw_status'), {}, runContext('s2'))
  assert.ok(none.includes('Machines connected to this session: (none — call sw_connect first)'), none)
})

/* --------------------------------------------------- 4) 隐式主机器与并集 */

test('connectedMachinesOf: the cwd route machine is implicit, read-only, and merged first', () => {
  const registry = registryOf({ c1: conn('c1'), c2: conn('c2') })
  assert.deepEqual(connectedMachinesOf('ssh://c1/srv/work', SESSION, () => ['c2'], registry), {
    sessionId: SESSION,
    ids: ['c1', 'c2'],
    implicit: 'c1',
  })
  // The implicit machine is never written back: the input list is untouched.
  const stored = ['c2']
  connectedMachinesOf('ssh://c1/srv/work', SESSION, () => stored, registry)
  assert.deepEqual(stored, ['c2'])
  // A local cwd has no implicit machine; the stored set stands alone.
  assert.deepEqual(connectedMachinesOf('C:\\proj', SESSION, () => ['c2'], registry).ids, ['c2'])
  // A route to an id the registry does not know is NOT an implicit connection.
  assert.equal(connectedMachinesOf('ssh://c9/srv', SESSION, () => [], registry).implicit, null)
  // An unresolvable session id is an honest `null`, not an empty session.
  assert.equal(connectedMachinesOf('ssh://c1/srv', undefined, () => [], registry).sessionId, null)
})

/* ------------------------------------------------------ 5) sw_exec 会话门（纯函数） */

test('requireConnectedServer: no connection ⇒ "call sw_connect first"', () => {
  assert.throws(
    () => requireConnectedServer({ sessionId: SESSION, ids: [], implicit: null }, undefined, ['c1']),
    /no machine is connected to this session — call sw_connect/,
  )
})

test('requireConnectedServer: an unresolvable session id fails closed', () => {
  assert.throws(
    () => requireConnectedServer({ sessionId: null, ids: [], implicit: null }, 'c1', ['c1']),
    /cannot resolve this session id — refusing to execute \(fail closed\)/,
  )
})

test('requireConnectedServer: registered-but-not-connected lists the connected ids', () => {
  assert.throws(
    () => requireConnectedServer({ sessionId: SESSION, ids: ['c1'], implicit: null }, 'c2', ['c1', 'c2']),
    /server "c2" is not connected to this session \(connected here: c1\)/,
  )
})

test('requireConnectedServer: an unknown id keeps the registry "unknown server" wording', () => {
  assert.throws(
    () => requireConnectedServer({ sessionId: SESSION, ids: ['c1'], implicit: null }, 'c9', ['c1', 'c2']),
    /unknown server "c9" — known: c1, c2/,
  )
})

test('requireConnectedServer: the implicit main machine passes, and an omitted server passes', () => {
  requireConnectedServer({ sessionId: SESSION, ids: ['c1'], implicit: 'c1' }, 'c1', ['c1'])
  requireConnectedServer({ sessionId: SESSION, ids: ['c1'], implicit: 'c1' }, undefined, ['c1'])
})

/* ------------------------------------------------------ 6) sw_exec 会话门（工具面） */

/** Mount `sw_exec` with a connected-machine accessor and a spawn marker. */
function mountSwExec(
  store: SessionConnectionsFace,
  options: { subprocessMarker?: string; registry?: unknown } = {},
): FakeCtx {
  const mounted = fakeHostCtx(options.subprocessMarker)
  registerSwExec(mounted.ctx, () => (options.registry ?? fakeRegistry()) as never, {
    connections: () => store,
  })
  return mounted
}

test('sw_exec tool: refuses with no session connection', async () => {
  const mounted = mountSwExec(readOnlyStore({}), { subprocessMarker: 'SPAWN-REACHED' })
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_exec'), { command: 'ls', description: 'list' }, runContext(SESSION, 'C:\\proj')),
    /no machine is connected to this session — call sw_connect\(machines: \[\.\.\.\]\) first/,
  )
})

test('sw_exec tool: refuses a registered-but-not-connected server and lists the connected ids', async () => {
  const mounted = mountSwExec(readOnlyStore({ [SESSION]: ['c1'] }), { subprocessMarker: 'SPAWN-REACHED' })
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_exec'), { command: 'ls', description: 'list', server: 'c2' }, runContext(SESSION, 'C:\\proj')),
    /server "c2" is not connected to this session \(connected here: c1\)/,
  )
})

test('sw_exec tool: the implicit main machine counts as connected (gate passes to the spawn seam)', async () => {
  const mounted = mountSwExec(readOnlyStore({}), { subprocessMarker: 'SPAWN-REACHED' })
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_exec'), { command: 'ls', description: 'list' }, runContext(SESSION, 'ssh://c1/srv/work')),
    /SPAWN-REACHED/,
  )
})

test('sw_exec tool: an unknown server id keeps the "unknown server" wording', async () => {
  const mounted = mountSwExec(readOnlyStore({ [SESSION]: ['c1'] }), { subprocessMarker: 'SPAWN-REACHED' })
  await assert.rejects(
    runTool(toolOf(mounted, 'sw_exec'), { command: 'ls', description: 'list', server: 'c9' }, runContext(SESSION, 'C:\\proj')),
    /unknown server "c9" — known: c1, c2/,
  )
})

test('sw_exec tool: a `ssh://` workdir naming an unconnected machine is refused too', async () => {
  const mounted = mountSwExec(readOnlyStore({ [SESSION]: ['c1'] }), { subprocessMarker: 'SPAWN-REACHED' })
  await assert.rejects(
    runTool(
      toolOf(mounted, 'sw_exec'),
      { command: 'ls', description: 'list', server: 'c1', workdir: 'ssh://c2/srv' },
      runContext(SESSION, 'C:\\proj'),
    ),
    /server "c2" is not connected to this session \(connected here: c1\)/,
  )
})

/* ------------------------------------------------------------------ 7) 提示面 */

test('renderSessionWorkspaceContext: empty for a session with no connections and no sides', () => {
  assert.equal(renderSessionWorkspaceContext([], []), '')
})

test('renderSessionWorkspaceContext: lists connected machines and side roots, English only', () => {
  const text = renderSessionWorkspaceContext(
    [connectedMachineFact('c1', { username: 'root', host: '10.0.0.5' })],
    [{ id: 'sw-1', kind: 'local', rootKey: join(sshRoutesRoot(), '..', 'side'), label: 'side' }],
  )
  assert.ok(text.includes('Machines connected to this session'))
  assert.ok(text.includes('- `c1` — root@10.0.0.5'), text)
  assert.ok(text.includes('Side workspace **side**'))
  assert.ok(!/[\p{Script=Han}]/u.test(text), 'model-facing text must be English only')
})

test('renderSessionWorkspaceContext: a machine with no registry fact falls back to its id label', () => {
  assert.ok(renderSessionWorkspaceContext([connectedMachineFact('c9', undefined)], []).includes('conn-c9'))
})

test('renderSessionWorkspaceContext: an unreachable machine is marked honestly', () => {
  const text = renderSessionWorkspaceContext([{ id: 'c1', endpoint: 'root@10.0.0.5', reachable: false }], [])
  assert.ok(text.includes('was unreachable at connect time'), text)
})
