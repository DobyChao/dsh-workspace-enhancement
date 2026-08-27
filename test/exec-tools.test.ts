/**
 * S1+S2 单测（drafts/sw-exec-requirement.md）：OS 探测纯函数与缓存、
 * shell argv 构建、workdir 归一、server 解析（缺省/未知 id）、swExecCore
 * 全链路（fake env，无网络）、超时标记、jobs 假桩注册、win32 bash 工具
 * 的注册条件与执行期本地/远程分支。
 * @module test/exec-tools
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  SW_EXEC_DEFAULT_TIMEOUT_MS,
  SW_EXEC_KILL_GRACE_MS,
  SW_EXEC_MAX_TIMEOUT_MS,
  buildShellArgv,
  createRemoteOsCache,
  defaultRemoteDir,
  makeSwExecDeadline,
  normalizeSwExecWorkdir,
  parseUnameAsync,
  parseVerProbe,
  registerSwExec,
  registerWin32Bash,
  renderStreamBody,
  renderSwExecForeground,
  resolveRemoteOs,
  resolveSwExecCwd,
  resolveSwExecServer,
  resolveSwExecTimeout,
  swExecCore,
} from '../src/exec-tools.ts'
import type { BackgroundJobs, SwExecConnection, SwExecEnv } from '../src/exec-tools.ts'
import type { SshRegistry } from '../src/registry.ts'
import type { SshConnectionSpec } from '../src/connection.ts'
import { sshRoutesRoot } from '../src/transport.ts'

/* --------------------------------------------------------------- 测试替身 */

/** Fake `.dsh`-independent placeholder cwd for remote sessions. */
function remotePlaceholder(id = 'c1'): string {
  return join(sshRoutesRoot(), id, 'srv', 'work')
}

function fakeStream(
  text: string,
  options: { lossy?: boolean; spillPath?: string } = {},
): SubprocessOutputReader {
  return {
    readFrom: () => ({
      text,
      nextOffset: 0,
      lossy: options.lossy ?? false,
      ...(options.spillPath !== undefined ? { spillPath: options.spillPath } : {}),
    }),
  }
}

function fakeHandle(
  _spec: SubprocessSpawnSpec | undefined,
  options: {
    outcome?: SubprocessOutcome
    stdout?: string
    stderr?: string
    stdoutLossy?: boolean
    stderrLossy?: boolean
    spillPath?: string
  } = {},
): SubprocessHandle {
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: fakeStream(options.stdout ?? 'OK', options.stdoutLossy === true ? { lossy: true, spillPath: options.spillPath } : {}),
      stderr: fakeStream(options.stderr ?? '', options.stderrLossy === true ? { lossy: true, spillPath: options.spillPath } : {}),
    },
    done: Promise.resolve(options.outcome ?? { exitCode: 0, signal: null }),
    terminate: () => {},
    waitForExit: async () => true,
  }
}

/** A handle that settles when the spawn spec's signal aborts (timeout tests). */
function abortableHandle(spec: SubprocessSpawnSpec): SubprocessHandle {
  let resolveDone!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>(resolve => { resolveDone = resolve })
  spec.signal?.addEventListener('abort', () => resolveDone({ exitCode: null, signal: 'SIGTERM' }), { once: true })
  return {
    pid: -1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: fakeStream(''), stderr: fakeStream('') },
    done,
    terminate: () => {},
    waitForExit: async () => true,
  }
}

function baseSpec(id: string, host: string, username: string): SshConnectionSpec {
  return { id, label: id, host, port: 22, username, workspace: `/srv/${id}` }
}

/** Default fake connection: uname → Linux, everything else empty-success. */
function fakeConnection(over: Partial<SwExecConnection> = {}): SwExecConnection {
  return {
    id: 'c1',
    endpoint: 'root@10.0.0.5',
    spec: baseSpec('c1', '10.0.0.5', 'root'),
    exec: async (command: string) => command.includes('uname')
      ? { exitCode: 0, signal: null, stdout: 'Linux\n', stderr: '' }
      : { exitCode: 1, signal: null, stdout: '', stderr: 'not found' },
    ...over,
  }
}

/** A fake SwExecEnv: records every spawn; a win32-uname variant is the default. */
function fakeEnv(
  connections: Record<string, SwExecConnection>,
  options: { active?: { spec: SshConnectionSpec; connection: SwExecConnection }; spawn?: (spec: SubprocessSpawnSpec) => SubprocessHandle } = {},
): SwExecEnv & { spawned: SubprocessSpawnSpec[] } {
  const spawned: SubprocessSpawnSpec[] = []
  return {
    spawned,
    get: id => connections[id],
    getActive: () => options.active ?? null,
    listMachines: () => ({ machines: Object.values(connections).map(connection => ({ id: connection.id })), currentId: null }),
    spawn: spec => {
      spawned.push(spec)
      return options.spawn !== undefined ? options.spawn(spec) : fakeHandle(spec)
    },
  }
}

/** A fake SshRegistry accessor standing in for the tool's `registry()` closure. */
function fakeRegistry(connections: Record<string, SwExecConnection>): () => SshRegistry {
  return () => ({
    get: (id: string) => connections[id] as never,
    getActive: () => null,
    listMachines: () => ({ machines: Object.values(connections).map(connection => ({ id: connection.id })), currentId: null }),
  }) as unknown as SshRegistry
}

interface CapturedTool {
  name: string
  description: string
  parameters: unknown
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<unknown>
  output: { schema: unknown; render: (args: unknown, value: unknown) => unknown[] }
}

interface CapturedSection {
  name: string
  order: number
  text: unknown
}

function fakeToolContext(options: { subprocess?: { spawn(spec: SubprocessSpawnSpec): SubprocessHandle }; jobs?: BackgroundJobs } = {}): {
  ctx: Context
  registered: CapturedTool[]
  sections: CapturedSection[]
} {
  const registered: CapturedTool[] = []
  const sections: CapturedSection[] = []
  const ctx = {
    get: (name: string) => {
      if (name === 'subprocess') return options.subprocess
      if (name === 'jobs') return options.jobs
      return undefined
    },
    tools: { register: (definition: CapturedTool) => { registered.push(definition); return () => {} } },
    systemPrompt: { section: (section: CapturedSection) => { sections.push(section); return () => {} } },
    effect: () => {},
  }
  return { ctx: ctx as unknown as Context, registered, sections }
}

/** The ToolRunContext face the tools read: `signal` + `agent.session.header.cwd`. */
function execFace(cwd?: string): { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } } {
  const agent = cwd !== undefined ? { session: { header: { cwd } } } : undefined
  return { signal: new AbortController().signal, ...(agent !== undefined ? { agent } : {}) }
}

/** An exec face whose call signal is ALREADY aborted (official preflight semantics). */
function abortedExecFace(cwd?: string): { signal: AbortSignal; agent?: { session: { header: { cwd?: string } } } } {
  const face = execFace(cwd)
  const controller = new AbortController()
  controller.abort()
  return { signal: controller.signal, ...(face.agent !== undefined ? { agent: face.agent } : {}) }
}

/** Assert the official abort contract: HarnessError, code 'ABORTED', name 'AbortError'. */
function assertAborted(error: unknown): boolean {
  assert.ok(error instanceof Error)
  assert.equal((error as { name?: string }).name, 'AbortError')
  assert.equal((error as { code?: string }).code, 'ABORTED')
  assert.notEqual((error as { code?: string }).code, undefined)
  return true
}

/* -------------------------------------------------------- 1) OS 探测纯函数 */

test('parseUnameAsync: POSIX families → linux; mingw/msys/cygwin → win32; unusable → null', () => {
  assert.equal(parseUnameAsync(0, 'Linux\n'), 'linux')
  assert.equal(parseUnameAsync(0, 'Darwin\n'), 'linux')
  assert.equal(parseUnameAsync(0, 'FreeBSD\n'), 'linux')
  assert.equal(parseUnameAsync(0, 'SunOS\n'), 'linux')
  assert.equal(parseUnameAsync(0, 'MINGW64_NT-10.0-19045\n'), 'win32')
  assert.equal(parseUnameAsync(0, 'MSYS_NT-10.0-19045\n'), 'win32')
  assert.equal(parseUnameAsync(0, 'CYGWIN_NT-10.0-19045\n'), 'win32')
  // No usable answer: fall through to the Windows probe.
  assert.equal(parseUnameAsync(0, ''), null)
  assert.equal(parseUnameAsync(1, 'Linux\n'), null)
  assert.equal(parseUnameAsync(null, 'Linux\n'), null)
})

test('parseVerProbe: exit 0 with output confirms win32; everything else null', () => {
  assert.equal(parseVerProbe(0, 'Microsoft Windows [Version 10.0.19045]\n'), 'win32')
  assert.equal(parseVerProbe(1, 'Microsoft Windows\n'), null)
  assert.equal(parseVerProbe(0, ''), null)
})

test('buildShellArgv: linux/unknown → bash -c; win32 → pwsh -Command', () => {
  assert.deepEqual(buildShellArgv('linux', 'make -j'), ['bash', '-c', 'make -j'])
  assert.deepEqual(buildShellArgv('unknown', 'ls'), ['bash', '-c', 'ls'])
  assert.deepEqual(buildShellArgv('win32', 'dir /b'), ['pwsh', '-Command', 'dir /b'])
})

/* ------------------------------------------------------ 2) 探测链 + 缓存 */

test('resolveRemoteOs: uname fails → cmd /c ver → win32; both fail → unknown', async () => {
  const called: string[] = []
  const conn = fakeConnection({
    exec: async (command: string) => {
      called.push(command)
      return command === 'uname -s'
        ? { exitCode: 1, signal: null, stdout: '', stderr: 'not recognized' }
        : { exitCode: 0, signal: null, stdout: 'Microsoft Windows [Version 10.0.19045]\n', stderr: '' }
    },
  })
  const cache = createRemoteOsCache()
  assert.equal(await resolveRemoteOs(conn, undefined, cache), 'win32')
  assert.deepEqual(called, ['uname -s', 'cmd /c ver'])
  // Cached on the SAME connection instance: no second probe.
  assert.equal(await resolveRemoteOs(conn, undefined, cache), 'win32')
  assert.deepEqual(called, ['uname -s', 'cmd /c ver'])

  const dead = fakeConnection({ exec: async () => ({ exitCode: 1, signal: null, stdout: '', stderr: '' }) })
  assert.equal(await resolveRemoteOs(dead, undefined, createRemoteOsCache()), 'unknown')
})

test('resolveRemoteOs: cache invalidates when a rebuilt connection reuses the id', async () => {
  const first = fakeConnection({ exec: async () => ({ exitCode: 0, signal: null, stdout: 'Linux\n', stderr: '' }) })
  const rebuilt = fakeConnection({ id: 'c1', exec: async () => ({ exitCode: 1, signal: null, stdout: '', stderr: '' }) })
  // A Windows-failing rebuilt connection is NOT the cached Linux answer.
  const cache = createRemoteOsCache()
  assert.equal(await resolveRemoteOs(first, undefined, cache), 'linux')
  assert.equal(await resolveRemoteOs(rebuilt, undefined, cache), 'unknown')
})

/* ------------------------------------------------------- 3) workdir 归一 */

test('normalizeSwExecWorkdir: ssh:// verbatim, absolute verbatim, relative against the session route', () => {
  const route = { id: 'c1', path: '/srv/work' }
  assert.equal(normalizeSwExecWorkdir(undefined, route), undefined)
  assert.equal(normalizeSwExecWorkdir('ssh://c2/deploy', null), 'ssh://c2/deploy')
  assert.equal(normalizeSwExecWorkdir('ssh://c2/', null), 'ssh://c2/')
  assert.equal(normalizeSwExecWorkdir('/opt/build', null), '/opt/build')
  assert.equal(normalizeSwExecWorkdir('src', route), '/srv/work/src')
  assert.equal(normalizeSwExecWorkdir('../x', route), '/srv/x')
  assert.throws(() => normalizeSwExecWorkdir('src', null), /relative workdir requires a remote session cwd/)
  assert.throws(() => normalizeSwExecWorkdir('ssh://c2', null), /invalid remote working directory/)
  assert.throws(() => normalizeSwExecWorkdir('C:\\proj', null), /must be a POSIX path/)
  assert.throws(() => normalizeSwExecWorkdir('', route), /must not be empty/)
})

test('resolveSwExecCwd: default → ssh://<server>/<machine dir>; ssh:// workdir wins the machine', () => {
  assert.deepEqual(resolveSwExecCwd(undefined, 'c1', '/srv/work'), { cwd: 'ssh://c1/srv/work', machineId: 'c1' })
  assert.deepEqual(resolveSwExecCwd(undefined, 'c1', '/'), { cwd: 'ssh://c1/', machineId: 'c1' })
  assert.deepEqual(resolveSwExecCwd(undefined, 'c1', ''), { cwd: 'ssh://c1/', machineId: 'c1' })
  assert.deepEqual(resolveSwExecCwd('ssh://c2/deploy', 'c1', '/srv/work'), { cwd: 'ssh://c2/deploy', machineId: 'c2' })
  assert.deepEqual(resolveSwExecCwd('/opt/x', 'c1', '/srv/work'), { cwd: 'ssh://c1/opt/x', machineId: 'c1' })
  assert.throws(() => resolveSwExecCwd('rel', 'c1', '/srv/work'), /absolute POSIX path/)
})

test('defaultRemoteDir: workspace wins, then cwd, then / (coerced absolute)', () => {
  assert.equal(defaultRemoteDir(baseSpec('c1', 'h', 'u')), '/srv/c1')
  assert.equal(defaultRemoteDir({ ...baseSpec('c1', 'h', 'u'), workspace: undefined, cwd: '/tmp' }), '/tmp')
  assert.equal(defaultRemoteDir({ ...baseSpec('c1', 'h', 'u'), workspace: undefined, cwd: undefined }), '/')
  assert.equal(defaultRemoteDir({ ...baseSpec('c1', 'h', 'u'), workspace: 'no-slash' }), '/')
})

/* ------------------------------------------------------- 4) server 解析 */

test('resolveSwExecServer: registry id, temp/active fallback, unknown error lists known ids', () => {
  const c1 = fakeConnection()
  const c2 = fakeConnection({ id: 'c2', endpoint: 'dev@10.0.0.9', spec: baseSpec('c2', '10.0.0.9', 'dev') })
  const env = fakeEnv({ c1, c2 })
  assert.equal(resolveSwExecServer(env, 'c1').connection.id, 'c1')
  assert.throws(() => resolveSwExecServer(env, 'nope'), /unknown server "nope" — known: c1, c2/)
  assert.throws(() => resolveSwExecServer(env, undefined), /no active server/)
  const temp = fakeConnection({ id: 'tmp-x', spec: baseSpec('tmp-x', '10.0.0.7', 'u') })
  const envTemp = fakeEnv({}, { active: { spec: temp.spec, connection: temp } })
  assert.equal(resolveSwExecServer(envTemp, 'tmp-x').connection.id, 'tmp-x')
  assert.equal(resolveSwExecServer(envTemp, undefined).connection.id, 'tmp-x')
})

/* ------------------------------------------------- 5) swExecCore 全链路 */

test('swExecCore: probes linux, spawns bash -c on ssh://c1/<workspace>, reports non-zero exits', async () => {
  const env = fakeEnv({ c1: fakeConnection() })
  const result = await swExecCore(env, 'c1', 'make', undefined, undefined, undefined, createRemoteOsCache())
  assert.equal(result.kind, 'foreground')
  assert.equal(result.server, 'c1')
  assert.equal(result.os, 'linux')
  assert.equal(result.exitCode, 0)
  assert.equal(result.stdout.text, 'OK')
  const spec = env.spawned[0]
  assert.ok(spec !== undefined)
  assert.deepEqual(spec.argv, ['bash', '-c', 'make'])
  assert.equal(spec.cwd, 'ssh://c1/srv/c1')
  assert.equal(spec.graceMs, 60_000)
  assert.equal(spec.stdio.stdin, 'ignore')
  assert.equal((spec.stdio.stdout as { maxBytes: number }).maxBytes, 1024 * 1024)
  assert.ok(renderSwExecForeground(result).startsWith('server: c1 (root@10.0.0.5) · OS: linux'))

  // Non-zero exits are a REPORT (with the marker), not a thrown error.
  const failedEnv = fakeEnv({ c1: fakeConnection() }, {
    spawn: () => fakeHandle(undefined, { outcome: { exitCode: 7, signal: null }, stdout: '', stderr: 'boom' }),
  })
  const failed = await swExecCore(failedEnv, 'c1', 'false', undefined, undefined, undefined, createRemoteOsCache())
  assert.equal(failed.exitCode, 7)
  const rendered = renderSwExecForeground(failed)
  assert.ok(rendered.includes('[stderr]\nboom'))
  assert.ok(rendered.includes('[exit code: 7]'))
})

test('swExecCore: a win32 target gets pwsh -Command; both probes failing → unknown keeps bash', async () => {
  const win32 = fakeConnection({
    exec: async (command: string) => command === 'uname -s'
      ? { exitCode: 1, signal: null, stdout: '', stderr: '' }
      : { exitCode: 0, signal: null, stdout: 'Microsoft Windows [Version 10.0.19045]', stderr: '' },
  })
  const envWin = fakeEnv({ c1: win32 })
  const resultWin = await swExecCore(envWin, 'c1', 'dir', undefined, undefined, undefined, createRemoteOsCache())
  assert.equal(resultWin.os, 'win32')
  assert.deepEqual(envWin.spawned[0]?.argv, ['pwsh', '-Command', 'dir'])

  const dead = fakeConnection({ exec: async () => ({ exitCode: 1, signal: null, stdout: '', stderr: '' }) })
  const envDead = fakeEnv({ c1: dead })
  const resultDead = await swExecCore(envDead, 'c1', 'ls', undefined, undefined, undefined, createRemoteOsCache())
  assert.equal(resultDead.os, 'unknown')
  assert.deepEqual(envDead.spawned[0]?.argv, ['bash', '-c', 'ls'])
})

test('swExecCore: timeoutMs kills the run and marks [timed out after Nms]', async () => {
  const env = fakeEnv({ c1: fakeConnection() }, { spawn: spec => abortableHandle(spec) })
  const result = await swExecCore(env, 'c1', 'sleep 100', undefined, 30, undefined, createRemoteOsCache())
  assert.equal(result.timedOut, true)
  assert.equal(result.signal, 'SIGTERM')
  assert.equal(result.timeoutMs, 30)
  assert.ok(renderSwExecForeground(result).includes('[timed out after 30ms]'))
  assert.ok(env.spawned[0]?.signal !== undefined)
})

test('resolveSwExecTimeout: omitted → executor default; overrides clamp at the max (dsh-bash-local semantics)', () => {
  assert.equal(resolveSwExecTimeout(undefined), SW_EXEC_DEFAULT_TIMEOUT_MS)
  assert.equal(resolveSwExecTimeout(30), 30)
  assert.equal(resolveSwExecTimeout(600_000), SW_EXEC_MAX_TIMEOUT_MS)
  assert.equal(resolveSwExecTimeout(999_999), SW_EXEC_MAX_TIMEOUT_MS)
  // The kill-escalation grace stays a separate constant (never the timeout value).
  assert.equal(SW_EXEC_KILL_GRACE_MS, 60_000)
  assert.notEqual(SW_EXEC_DEFAULT_TIMEOUT_MS, SW_EXEC_KILL_GRACE_MS)
})

test('swExecCore: an omitted timeout applies the default bound and reports it in the value', async () => {
  const env = fakeEnv({ c1: fakeConnection() })
  const result = await swExecCore(env, 'c1', 'make', undefined, undefined, undefined, createRemoteOsCache())
  assert.equal(result.timeoutMs, SW_EXEC_DEFAULT_TIMEOUT_MS)
  assert.equal(env.spawned[0]?.graceMs, SW_EXEC_KILL_GRACE_MS)
})

test('swExecCore: an explicit ssh:// workdir names the machine (OS + header follow it)', async () => {
  const c2 = fakeConnection({ id: 'c2', endpoint: 'dev@10.0.0.9', spec: baseSpec('c2', '10.0.0.9', 'dev') })
  const env = fakeEnv({ c1: fakeConnection(), c2 })
  const result = await swExecCore(env, 'c1', 'ls', 'ssh://c2/deploy', undefined, undefined, createRemoteOsCache())
  assert.equal(result.server, 'c2')
  assert.equal(env.spawned[0]?.cwd, 'ssh://c2/deploy')
})

test('swExecCore: unknown server errors with the known list; a spawn rejection propagates', async () => {
  const env = fakeEnv({ c1: fakeConnection() })
  await assert.rejects(
    () => swExecCore(env, 'nope', 'ls', undefined, undefined, undefined, createRemoteOsCache()),
    /unknown server "nope" — known: c1/,
  )
  const gated = fakeEnv({ c1: fakeConnection() }, {
    spawn: () => { throw new Error('dsw: execution is disabled for the side workspace "x" (exec: off).') },
  })
  await assert.rejects(
    () => swExecCore(gated, 'c1', 'ls', undefined, undefined, undefined, createRemoteOsCache()),
    /exec: off/,
  )
})

test('makeSwExecDeadline: no timeout never fires; caller abort is forwarded', async () => {
  const controller = new AbortController()
  const deadline = makeSwExecDeadline(undefined, controller.signal)
  assert.equal(deadline.timedOut(), false)
  controller.abort()
  assert.equal(deadline.signal.aborted, true)
  deadline.dispose()
})

/* ------------------------------------------------- 6) 工具注册 + 执行 */

test('registerSwExec: registers sw_exec + tool:sw-exec; server derives from the session cwd', async () => {
  const spawned: SubprocessSpawnSpec[] = []
  const fake = fakeToolContext({ subprocess: { spawn: spec => { spawned.push(spec); return fakeHandle(spec, { stdout: 'built' }) } } })
  registerSwExec(fake.ctx, fakeRegistry({ c1: fakeConnection() }))
  assert.deepEqual(fake.registered.map(tool => tool.name), ['sw_exec'])
  assert.deepEqual(fake.sections.map(section => section.name), ['tool:sw-exec'])
  assert.equal(fake.sections[0]?.order, 105)
  const result = await fake.registered[0]?.execute?.({ command: 'make', description: 'Build' }, execFace('ssh://c1/srv'))
  assert.ok(result !== undefined && (result as { kind: string }).kind === 'foreground')
  assert.equal((result as { server: string }).server, 'c1')
  assert.deepEqual(spawned[0]?.argv, ['bash', '-c', 'make'])
  assert.equal(spawned[0]?.cwd, 'ssh://c1/srv/c1')
})

test('registerSwExec: explicit server wins; a local session without one errors', async () => {
  const spawned: SubprocessSpawnSpec[] = []
  const fake = fakeToolContext({ subprocess: { spawn: spec => { spawned.push(spec); return fakeHandle(spec) } } })
  const c2 = fakeConnection({ id: 'c2', endpoint: 'dev@10.0.0.9', spec: baseSpec('c2', '10.0.0.9', 'dev') })
  registerSwExec(fake.ctx, fakeRegistry({ c1: fakeConnection(), c2 }))
  const execute = fake.registered[0]?.execute
  assert.ok(execute !== undefined)
  // Local session + local cwd → the server is genuinely unknown.
  await assert.rejects(
    () => execute({ command: 'ls', description: 'List' }, execFace('C:\\Users\\me\\proj')),
    /sw_exec: server required for local sessions/,
  )
  // Local session, explicit server → works and reports that server.
  const result = await execute({ command: 'whoami', description: 'Print user', server: 'c2' }, execFace('C:\\Users\\me\\proj'))
  assert.equal((result as { server: string }).server, 'c2')
  assert.deepEqual(spawned[0]?.cwd, 'ssh://c2/srv/c2')
  // Relative workdir resolves against the REMOTE session route.
  const resultRel = await execute({ command: 'ls', description: 'List', workdir: 'src' }, execFace('ssh://c1/srv'))
  assert.equal((resultRel as { cwd?: never }).kind, 'foreground')
  assert.equal(spawned[1]?.cwd, 'ssh://c1/srv/src')
})

test('registerSwExec: run_in_background errors honestly without ctx.jobs', async () => {
  const fake = fakeToolContext({ subprocess: { spawn: () => fakeHandle(undefined) } })
  registerSwExec(fake.ctx, fakeRegistry({ c1: fakeConnection() }))
  await assert.rejects(
    () => fake.registered[0]?.execute?.({ command: 'make', description: 'Build', run_in_background: true }, execFace('ssh://c1/srv')),
    /background jobs unavailable: load @deepseek-ai\/dsh-jobs and @deepseek-ai\/dsh-tool-jobs/,
  )
})

test('registerSwExec: run_in_background registers via ctx.jobs (kind/label/owner/hooks)', async () => {
  const started: { kind: string; label: string; owner?: unknown; run(): { cancel: (reason?: string) => void; done: Promise<unknown>; readOutput?: () => string } }[] = []
  const jobs: BackgroundJobs = {
    start(spec) {
      started.push(spec)
      return 'sw-exec-1'
    },
  }
  const spawned: SubprocessSpawnSpec[] = []
  const fake = fakeToolContext({ subprocess: { spawn: spec => { spawned.push(spec); return fakeHandle(spec, { stdout: 'bg done' }) } }, jobs })
  registerSwExec(fake.ctx, fakeRegistry({ c1: fakeConnection() }))
  const agent = { session: { header: { cwd: 'ssh://c1/srv' } } }
  const result = await fake.registered[0]?.execute?.(
    { command: 'make', description: 'Build', run_in_background: true },
    { signal: new AbortController().signal, agent },
  )
  assert.deepEqual(result, { kind: 'background', jobId: 'sw-exec-1', server: 'c1', endpoint: 'root@10.0.0.5' })
  assert.equal(started.length, 1)
  assert.equal(started[0]?.kind, 'sw-exec')
  assert.equal(started[0]?.label, 'c1: make')
  assert.equal(started[0]?.owner, agent)
  // The job hooks spawn through the same provider; done maps to the job outcome.
  const hooks = started[0]?.run()
  assert.ok(hooks !== undefined)
  assert.deepEqual(spawned[0]?.argv, ['bash', '-c', 'make'])
  assert.deepEqual(await hooks.done, { status: 'completed', detail: 'exit code: 0' })
})

test('registerSwExec: an aborted call throws the official HarnessError (ABORTED/AbortError)', async () => {
  const spawned: SubprocessSpawnSpec[] = []
  const fake = fakeToolContext({ subprocess: { spawn: spec => { spawned.push(spec); return fakeHandle(spec) } } })
  registerSwExec(fake.ctx, fakeRegistry({ c1: fakeConnection() }))
  const execute = fake.registered[0]?.execute
  assert.ok(execute !== undefined)
  // Foreground: the run settles, then the aborted caller signal surfaces as ABORTED.
  await assert.rejects(
    () => execute({ command: 'ls', description: 'List' }, abortedExecFace('ssh://c1/srv')),
    assertAborted,
  )
  // Background: the abort preflight fires BEFORE job registration — no orphan job.
  const started: unknown[] = []
  const fakeBg = fakeToolContext({ subprocess: { spawn: () => fakeHandle(undefined) }, jobs: { start: spec => { started.push(spec); return 'sw-exec-1' } } })
  registerSwExec(fakeBg.ctx, fakeRegistry({ c1: fakeConnection() }))
  await assert.rejects(
    () => fakeBg.registered[0]?.execute?.({ command: 'make', description: 'Build', run_in_background: true }, abortedExecFace('ssh://c1/srv')),
    assertAborted,
  )
  assert.deepEqual(started, [])
})

test('registerWin32Bash: an aborted call throws the official HarnessError before registering a job', async () => {
  const started: unknown[] = []
  const fake = fakeToolContext({ subprocess: { spawn: () => fakeHandle(undefined) }, jobs: { start: spec => { started.push(spec); return 'bash-1' } } })
  registerWin32Bash(fake.ctx, fakeRegistry({}), { platform: 'win32' })
  await assert.rejects(
    () => fake.registered[0]?.execute?.({ command: 'make', description: 'Build', run_in_background: true }, abortedExecFace(remotePlaceholder('c1'))),
    assertAborted,
  )
  assert.deepEqual(started, [])
})

/* ---------------------------------------------------- 7) win32 bash 工具 */

test('registerWin32Bash: POSIX host is a no-op; win32 registers bash + tool:bash section', () => {
  const posix = fakeToolContext({})
  registerWin32Bash(posix.ctx, fakeRegistry({}), { platform: 'linux' })
  assert.deepEqual(posix.registered, [])
  assert.deepEqual(posix.sections, [])
  const win = fakeToolContext({})
  registerWin32Bash(win.ctx, fakeRegistry({}), { platform: 'win32' })
  assert.deepEqual(win.registered.map(tool => tool.name), ['bash'])
  assert.deepEqual(win.sections.map(section => section.name), ['tool:bash'])
  assert.equal(win.sections[0]?.order, 105)
})

test('registerWin32Bash execute: a local Windows session errors instead of silently degrading', async () => {
  const fake = fakeToolContext({})
  registerWin32Bash(fake.ctx, fakeRegistry({}), { platform: 'win32' })
  await assert.rejects(
    () => fake.registered[0]?.execute?.({ command: 'ls', description: 'List' }, execFace('C:\\Users\\me\\proj')),
    /bash 工具面向远程 Linux 工作区（本机 Windows 无 bash）；请使用 pwsh 或终端面板/,
  )
})

test('registerWin32Bash execute: a remote session runs bash -c through the mixed provider', async () => {
  const spawned: SubprocessSpawnSpec[] = []
  const fake = fakeToolContext({ subprocess: { spawn: spec => { spawned.push(spec); return fakeHandle(spec, { stdout: 'from remote' }) } } })
  registerWin32Bash(fake.ctx, fakeRegistry({ c1: fakeConnection() }), { platform: 'win32' })
  const result = await fake.registered[0]?.execute?.({ command: 'uname -a', description: 'Show kernel' }, execFace(remotePlaceholder('c1')))
  assert.equal((result as { kind: string }).kind, 'foreground')
  assert.equal((result as { stdout: { text: string } }).stdout.text, 'from remote')
  assert.deepEqual(spawned[0]?.argv, ['bash', '-c', 'uname -a'])
  assert.equal(spawned[0]?.cwd, remotePlaceholder('c1'))
  // A relative workdir resolves against the session workspace (official semantics).
  const spawned2: SubprocessSpawnSpec[] = []
  const fake2 = fakeToolContext({ subprocess: { spawn: spec => { spawned2.push(spec); return fakeHandle(spec) } } })
  registerWin32Bash(fake2.ctx, fakeRegistry({}), { platform: 'win32' })
  await fake2.registered[0]?.execute?.({ command: 'pwd', description: 'Print dir', workdir: 'src' }, execFace(remotePlaceholder('c1')))
  assert.equal(spawned2[0]?.cwd, join(remotePlaceholder('c1'), 'src'))
})

/* ----------------------------------------------------------- 8) 输出渲染 */

test('renderStreamBody: stderr section, truncation notice, and exit markers', () => {
  const text = renderStreamBody({
    exitCode: 2,
    signal: null,
    timedOut: false,
    timeoutMs: 60_000,
    stdout: { text: 'out', truncated: false },
    stderr: { text: 'err', truncated: true, spillPath: 'C:\\spill\\stderr' },
  })
  assert.ok(text.includes('[stderr]\nerr'))
  assert.ok(text.includes('[output truncated; full output: C:\\spill\\stderr]'))
  assert.ok(text.includes('[exit code: 2]'))
  // Terminal signal beats the exit-code marker; timeouts report their budget.
  const killed = renderStreamBody({
    exitCode: null, signal: 'SIGKILL', timedOut: false, timeoutMs: 60_000,
    stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false },
  })
  assert.ok(killed.includes('[killed by signal: SIGKILL]'))
  assert.ok(!killed.includes('exit code'))
  const timed = renderStreamBody({
    exitCode: null, signal: null, timedOut: true, timeoutMs: 250,
    stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false },
  })
  assert.ok(timed.includes('[timed out after 250ms]'))
  assert.ok(timed.includes('(no output)'))
})
