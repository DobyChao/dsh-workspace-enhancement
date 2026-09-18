/**
 * BUG-9 regression suite: remote tasks must actually stop.
 *
 * Covers the three legs from rounds/R31:
 *  - direct ssh2 leg: pid echo + peel, independent-channel group kill,
 *    KILL→close fallback, startup-window abort;
 *  - core leg: pending-abort across the spawn.start window, non-silent
 *    spawn.terminate delivery failures;
 *  - tool layer: `awaitOutcomeOrStop` never waits forever.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client, ClientChannel } from 'ssh2'
import type { SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SshSubprocessHandle } from '../src/process.ts'
import { CoreSubprocessHandle } from '../src/core-process.ts'
import type { SshTransport } from '../src/transport.ts'
import type { CoreClient } from '../src/core-client.ts'
import type { CoreHub } from '../src/core-hub.ts'
import { CORE_EVENTS } from '../src/core-protocol.ts'
import { awaitOutcomeOrStop, UnsettledStopError } from '../src/exec-tools.ts'

/* --------------------------------------------------------- direct-leg fake */

function fakeChannel(): ClientChannel & {
  signals: string[]
  closed: boolean
  emitData: (chunk: string) => void
  emitClose: (code: number | null) => void
} {
  const channel = new EventEmitter() as unknown as ClientChannel & {
    signals: string[]
    closed: boolean
    emitData: (chunk: string) => void
    emitClose: (code: number | null) => void
  }
  channel.signals = []
  channel.closed = false
  channel.stderr = new PassThrough()
  channel.signal = (name: string): void => { channel.signals.push(name) }
  channel.end = (): void => {}
  channel.close = (): void => { channel.closed = true }
  channel.emitData = (chunk: string): void => { channel.emit('data', Buffer.from(chunk)) }
  channel.emitClose = (code: number | null): void => { channel.emit('close', code, null) }
  return channel
}

/**
 * Transport whose client distinguishes the SPAWN exec (handed to the test via
 * `deliver()`) from KILL execs (recorded and closed immediately).
 */
function directHarness(): {
  transport: SshTransport
  channel: ReturnType<typeof fakeChannel>
  killCommands: string[]
  deliver: () => Promise<void>
  mainCommand: () => string | undefined
} {
  const channel = fakeChannel()
  const killCommands: string[] = []
  let spawnCallback: ((error: undefined, stream: ClientChannel) => void) | undefined
  let mainCommand: string | undefined
  const transport: SshTransport = {
    endpoint: 'root@srv.example',
    cwd: '/srv/work',
    getClient: async () => ({
      exec(command: string, _options: unknown, callback: (error: undefined, stream: ClientChannel) => void) {
        if (command.startsWith('kill ') === true) {
          killCommands.push(command)
          const killer = fakeChannel()
          setImmediate(() => {
            callback(undefined, killer)
            setImmediate(() => { killer.emit('close', 0, null) })
          })
          return
        }
        mainCommand = command
        spawnCallback = callback
      },
    }) as unknown as Client,
    getSftp: async () => { throw new Error('unexpected getSftp') },
    getRemoteEnvironment: async () => ({ PATH: '/usr/bin:/bin', HOME: '/root' }),
    exec: async () => { throw new Error('unexpected transport.exec') },
    resolveRemoteCwd: () => '/srv/work',
  }
  return {
    transport,
    channel,
    killCommands,
    // The startup chain (env read → client → exec) runs on microtasks; poll
    // until the spawn callback is armed instead of assuming a tick count.
    deliver: async () => {
      const deadline = Date.now() + 2_000
      while (spawnCallback === undefined && Date.now() < deadline) await sleep(10)
      assert.ok(spawnCallback !== undefined, 'spawn exec never armed')
      ;(spawnCallback as NonNullable<typeof spawnCallback>)(undefined, channel)
    },
    mainCommand: () => mainCommand,
  }
}

const spec = (graceMs = 60): SubprocessSpawnSpec => ({
  argv: ['bash', '-c', 'echo hi'],
  cwd: 'ssh://c1/srv/work',
  stdio: { stdin: { data: '' }, stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
  graceMs,
})

const spill = (): string => mkdtempSync(join(tmpdir(), 'dsw-bug9-'))
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })
const collectedOf = (handle: SshSubprocessHandle): string => handle.collected?.stdout?.readFrom(0).text ?? ''

/** Guard every `done` await: a lost event must fail the test, not hang the single-process suite. */
async function withTimeout<T>(promise: Promise<T>, label: string, ms = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/* ---------------------------------------------------- direct leg: the peel */

test('BUG-9 direct: the serialized command prefixes the pid echo', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(), spill())
  await h.deliver()
  h.channel.emitData('4242\n')
  h.channel.emitClose(0)
  await withTimeout(handle.done, 'done' )
  assert.match(h.mainCommand() ?? '', /cd -- '\/srv\/work' && echo \$\$ && exec env -i --/, 'pid echo rides at the head of the command')
})

test('BUG-9 direct: pid line is peeled off stdout, split chunks included', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(), spill())
  await h.deliver()
  h.channel.emitData('424')
  h.channel.emitData('2\n')
  h.channel.emitData('hello')
  h.channel.emitClose(0)
  const outcome = await withTimeout(handle.done, 'done' )
  assert.equal(outcome.exitCode, 0)
  assert.equal(handle.pid, 4242, 'the remote pid is exposed once the line lands')
  assert.equal(collectedOf(handle), 'hello', 'the pid line never reaches the collected stream')
})

test('BUG-9 direct: a non-numeric first line bypasses the peel and streams verbatim', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(), spill())
  await h.deliver()
  h.channel.emitData('not-a-pid\nhello')
  h.channel.emitClose(0)
  await withTimeout(handle.done, 'done' )
  assert.equal(handle.pid, -1)
  assert.equal(collectedOf(handle), 'not-a-pid\nhello')
})

test('BUG-9 direct: a channel closed mid-first-line flushes the buffered bytes', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(), spill())
  await h.deliver()
  h.channel.emitData('partial-without-newline')
  h.channel.emitClose(0)
  await withTimeout(handle.done, 'done' )
  assert.equal(collectedOf(handle), 'partial-without-newline', 'nothing is swallowed on early close')
})

/* --------------------------------------------- direct leg: the stop chain */

test('BUG-9 direct: terminate escalates signal + independent-channel group kill, then closes', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(500), spill())
  await h.deliver()
  h.channel.emitData('31337\n')
  handle.terminate()
  assert.deepEqual(h.channel.signals, ['TERM'], 'signal request stays the first hop')
  await sleep(40)
  assert.equal(h.killCommands.length, 1, 'a kill went out on an independent channel')
  assert.match(h.killCommands[0] ?? '', /^kill -TERM -- -31337 2>\/dev\/null; kill -TERM 31337 2>\/dev\/null; true$/)
  await sleep(700) // past the 500ms grace
  assert.deepEqual(h.channel.signals, ['TERM', 'KILL'], 'grace escalates to KILL')
  assert.equal(h.killCommands.length, 2, 'the escalation repeats through the kill channel')
  assert.match(h.killCommands[1] ?? '', /^kill -KILL -- -31337/)
  // Nothing settles the channel, so the close fallback must fire (grace 500ms
  // + KILL_CLOSE_FALLBACK_MS). Poll instead of sleeping a fixed 2.5s.
  const deadline = Date.now() + 5_000
  while (h.channel.closed !== true && Date.now() < deadline) await sleep(50)
  assert.equal(h.channel.closed, true, 'the channel is force-closed so `done` cannot hang')
  h.channel.emitClose(null)
  const outcome = await withTimeout(handle.done, 'escalation done')
  assert.equal(outcome.exitCode, null)
})

test('BUG-9 direct: a pid line arriving AFTER terminate still triggers the kill', async () => {
  const h = directHarness()
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(4_000), spill())
  await h.deliver()
  handle.terminate() // before any stdout: no pid yet
  await sleep(20)
  assert.deepEqual(h.killCommands, [], 'nothing to kill without a pid')
  h.channel.emitData('999\n') // late pid — the pending stop must ride it
  await sleep(50)
  assert.equal(h.killCommands.length, 1)
  assert.match(h.killCommands[0] ?? '', /^kill -TERM -- -999 /)
  h.channel.emitClose(null)
  await withTimeout(handle.done, 'done' )
})

test('BUG-9 direct: an abort in the startup window never starts the remote command', async () => {
  const h = directHarness()
  let releasePreflight: (() => void) | undefined
  const preflight = new Promise<void>(resolve => { releasePreflight = resolve })
  const handle = new SshSubprocessHandle(h.transport, '/srv/work', spec(), spill(), () => preflight)
  handle.terminate()
  ;(releasePreflight as NonNullable<typeof releasePreflight>)()
  await assert.rejects(() => handle.done, /terminated/)
  assert.equal(h.mainCommand(), undefined, 'the command never reached the client')
  assert.deepEqual(h.killCommands, [], 'and no kill round-trip was needed')
})

/* ------------------------------------------------------------- core leg */

class FakeCoreClient {
  readonly calls: Array<{ method: string; params: unknown }> = []
  private readonly sinks: Array<(method: string, params: unknown) => void> = []
  /** Fail spawn.terminate calls while true (retry testing). */
  terminateFail = false
  /** Job id spawn.start replies with once released. */
  startJob = '7'
  /** While set, spawn.start's reply is held back (events can still flow). */
  holdStart = false
  private startWaiters: Array<() => void> = []
  private startHeld = false

  async call(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    if (this.terminateFail === true && method === 'spawn.terminate') throw new Error('rpc down')
    if (method === 'spawn.start') {
      if (this.holdStart === true) {
        this.startHeld = true
        await new Promise<void>(resolve => { this.startWaiters.push(resolve) })
      }
      return { job: this.startJob }
    }
    return {}
  }

  releaseStart(): void {
    this.holdStart = false
    if (this.startHeld === true) {
      this.startHeld = false
      for (const resolve of this.startWaiters.splice(0)) resolve()
    }
  }

  onEvent(sink: (method: string, params: unknown) => void): () => void {
    this.sinks.push(sink)
    return () => {
      const index = this.sinks.indexOf(sink)
      if (index >= 0) this.sinks.splice(index, 1)
    }
  }

  emit(method: string, params: unknown): void {
    for (const sink of [...this.sinks]) sink(method, params)
  }
}

function coreHubFake(client: FakeCoreClient, options: {
  requireGate?: () => Promise<void>
  peekClient?: () => FakeCoreClient | undefined
} = {}): CoreHub {
  return {
    modeOf: () => 'read-only',
    require: async () => { await options.requireGate?.(); return client as unknown as CoreClient },
    peek: () => (options.peekClient !== undefined ? options.peekClient() : client) as unknown as CoreClient,
    hold: () => () => {},
    status: async () => { throw new Error('unused') },
    close: () => {},
  } as unknown as CoreHub
}

const coreSpec = (signal?: AbortSignal): SubprocessSpawnSpec => ({
  argv: ['bash', '-c', 'echo hi'],
  cwd: 'ssh://c1/srv/work',
  stdio: { stdin: { data: '' }, stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
  graceMs: 1_000,
  ...(signal !== undefined ? { signal } : {}),
})

test('BUG-9 core: an abort during hub.require is remembered and delivered once the job id lands', async () => {
  const client = new FakeCoreClient()
  let releaseRequire: (() => void) | undefined
  const gate = new Promise<void>(resolve => { releaseRequire = resolve })
  const hub = coreHubFake(client, { requireGate: () => gate })
  const controller = new AbortController()
  const handle = new CoreSubprocessHandle(hub, 'c1', '/srv/work', coreSpec(controller.signal), spill())
  // The stop lands while spawn.start has not even been SENT (cold core window).
  controller.abort()
  ;(releaseRequire as NonNullable<typeof releaseRequire>)()
  await sleep(30) // let run() subscribe (watch) and send spawn.start first
  client.emit(CORE_EVENTS.spawnExit, { job: '7', exitCode: 0, signal: null })
  const outcome = await withTimeout(handle.done, 'pending-abort done')
  assert.equal(outcome.exitCode, 0)
  const methods = client.calls.map(call => call.method)
  assert.ok(methods.indexOf('spawn.terminate') > methods.indexOf('spawn.start'), 'terminate was sent after the job id appeared')
  assert.equal(methods.filter(name => name === 'spawn.terminate').length, 1, 'exactly one terminate, not one per event')
  assert.equal(handle.lastTerminateFailure, undefined)
})

test('BUG-9 core: a peek miss is recorded, not swallowed — and a later retry delivers', async () => {
  const client = new FakeCoreClient()
  client.holdStart = true
  client.startJob = '11'
  let peekAvailable = false
  const hub = coreHubFake(client, { peekClient: () => (peekAvailable ? client : undefined) })
  const handle = new CoreSubprocessHandle(hub, 'c1', '/srv/work', coreSpec(), spill())
  await sleep(30) // watch() subscribed, spawn.start reply held back
  handle.terminate() // pending, but no job id yet — nothing sendable
  client.emit(CORE_EVENTS.spawnStdout, { job: '11', b64: '' }) // event names the job, peek MISSES
  assert.ok(handle.lastTerminateFailure instanceof Error, 'the miss is observable')
  assert.equal((handle.lastTerminateFailure as Error).message, 'core client unavailable for spawn.terminate')
  assert.ok(client.calls.every(call => call.method !== 'spawn.terminate'), 'nothing was sent')
  peekAvailable = true
  client.emit(CORE_EVENTS.spawnStderr, { job: '11', b64: '' }) // next event retries
  assert.ok(client.calls.some(call => call.method === 'spawn.terminate' && (call.params as { job: string }).job === '11'))
  client.releaseStart()
  client.emit(CORE_EVENTS.spawnExit, { job: '11', exitCode: 0, signal: null })
  await withTimeout(handle.done, 'done' )
})

test('BUG-9 core: a failed terminate RPC is recorded and un-latched for the next trigger', async () => {
  const client = new FakeCoreClient()
  client.holdStart = true
  client.startJob = '3'
  client.terminateFail = true
  const hub = coreHubFake(client)
  const handle = new CoreSubprocessHandle(hub, 'c1', '/srv/work', coreSpec(), spill())
  await sleep(30)
  client.emit(CORE_EVENTS.spawnStdout, { job: '3', b64: '' }) // job learned from the event stream
  handle.terminate()
  await sleep(20)
  assert.equal(client.calls.filter(call => call.method === 'spawn.terminate').length, 1, 'the failed attempt went out')
  assert.ok(handle.lastTerminateFailure instanceof Error, 'the RPC failure is observable')
  client.terminateFail = false
  client.emit(CORE_EVENTS.spawnStderr, { job: '3', b64: '' }) // next event retries
  await sleep(20)
  assert.equal(client.calls.filter(call => call.method === 'spawn.terminate').length, 2, 'retry went out')
  client.releaseStart()
  client.emit(CORE_EVENTS.spawnExit, { job: '3', exitCode: 0, signal: null })
  await withTimeout(handle.done, 'done' )
})

/* --------------------------------------------------------- tool layer race */

test('BUG-9 tools: awaitOutcomeOrStop resolves when done settles inside the window', async () => {
  const controller = new AbortController()
  let release: ((outcome: SubprocessOutcome) => void) | undefined
  const done = new Promise<SubprocessOutcome>(resolve => { release = resolve })
  const awaited = awaitOutcomeOrStop(done, controller.signal, 5_000)
  controller.abort()
  setTimeout(() => { (release as NonNullable<typeof release>)({ exitCode: 1, signal: null }) }, 20)
  assert.equal((await awaited).exitCode, 1)
})

test('BUG-9 tools: awaitOutcomeOrStop rejects with UnsettledStopError once the window lapses', async () => {
  const controller = new AbortController()
  const never = new Promise<SubprocessOutcome>(() => {})
  const awaited = awaitOutcomeOrStop(never, controller.signal, 30)
  controller.abort()
  await assert.rejects(() => awaited, UnsettledStopError)
})

test('BUG-9 tools: no signal means plain passthrough', async () => {
  const outcome: SubprocessOutcome = { exitCode: 0, signal: null }
  assert.equal(await awaitOutcomeOrStop(Promise.resolve(outcome), undefined), outcome)
})
