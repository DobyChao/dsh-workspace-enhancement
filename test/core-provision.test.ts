/**
 * REQ-I14: connection warmup (fenced machine → background status → deploy)
 * and the first-use approval ask (platform approval → deployCore → hub close).
 * @module test/core-provision
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CORE_ARTIFACT_VERSION } from '../src/core-protocol.ts'
import {
  CORE_DEPLOY_ASK_MARKER,
  CORE_DEPLOY_TOOL_NAME,
  coreDeployAskReason,
  createCoreGapAsker,
  createCoreWarmup,
} from '../src/core-provision.ts'
import type { CoreStatusView } from '../src/core-hub.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import type { SshTransport } from '../src/transport.ts'

/* ------------------------------------------------------------- warmup */

interface WarmupLog {
  status: string[]
  deploys: string[]
  closed: string[]
  warns: string[]
}

function warmupHarness(machine: { remoteSandbox?: string } | undefined, status: CoreStatusView, deployResult: CoreStatusView) {
  const log: WarmupLog = { status: [], deploys: [], closed: [], warns: [] }
  const warm = createCoreWarmup({
    machine: (id) => (id === 'c1' ? machine as never : undefined),
    connection: (id) => (id === 'c1' ? ({} as SshTransport) : undefined),
    status: async (id) => {
      log.status.push(id)
      return status
    },
    deploy: async (id) => {
      log.deploys.push(id)
      return deployResult
    },
    afterDeploy: (id) => { log.closed.push(id) },
    warn: (text) => { log.warns.push(text) },
  })
  return { warm, log }
}

test('warmup: an unfenced machine never touches the disk', async () => {
  const { warm, log } = warmupHarness({ remoteSandbox: 'off' }, { ok: false }, { ok: true })
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log, { status: [], deploys: [], closed: [], warns: [] })
})

test('warmup: a machine without a record (unknown) is skipped', async () => {
  const { warm, log } = warmupHarness(undefined, { ok: false }, { ok: true })
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(log.status.length, 0)
})

test('warmup: current artifact on disk deploys nothing', async () => {
  const { warm, log } = warmupHarness(
    { remoteSandbox: 'read-only' },
    { ok: true, version: CORE_ARTIFACT_VERSION },
    { ok: true },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.equal(log.deploys.length, 0)
})

test('warmup: a fenced machine with a stale/missing core deploys and drops stale serves', async () => {
  const { warm, log } = warmupHarness(
    { remoteSandbox: 'workspace-write' },
    { ok: true, version: '0.0.1-old' },
    { ok: true, version: CORE_ARTIFACT_VERSION },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.deepEqual(log.deploys, ['c1'])
  assert.deepEqual(log.closed, ['c1'], 'afterDeploy must drop stale serves (old current)')
  assert.equal(log.warns.length, 0)
})

test('warmup: a failed deploy warns and keeps the status quo', async () => {
  const { warm, log } = warmupHarness(
    { remoteSandbox: 'read-only' },
    { ok: false, detail: 'core not installed' },
    { ok: false, detail: 'connection refused' },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(log.deploys.length, 1)
  assert.deepEqual(log.closed, [], 'a failed deploy must not drop serves')
  assert.equal(log.warns.length, 1)
  assert.match(log.warns[0] ?? '', /connection refused/)
})

test('warmup: concurrent triggers deduplicate to ONE status→deploy run', async () => {
  const log: WarmupLog = { status: [], deploys: [], closed: [], warns: [] }
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const warm = createCoreWarmup({
    machine: (id) => (id === 'c1' ? { remoteSandbox: 'read-only' } as never : undefined),
    connection: (id) => (id === 'c1' ? ({} as SshTransport) : undefined),
    status: async (id) => {
      log.status.push(id)
      await gate
      return { ok: false, detail: 'core not installed' }
    },
    deploy: async (id) => {
      log.deploys.push(id)
      return { ok: true, version: CORE_ARTIFACT_VERSION }
    },
    afterDeploy: (id) => { log.closed.push(id) },
    warn: (text) => { log.warns.push(text) },
  })
  warm('c1')
  warm('c1')
  warm('c1')
  release?.()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.deepEqual(log.deploys, ['c1'])
})

/* ------------------------------------------------- first-use approval ask */

/** A transport whose exec answers exactly the deployCore command ladder. */
function deployTransport(): SshTransport & { commands: string[] } {
  const commands: string[] = []
  const outcome = (stdout = ''): ExecOutcome => ({ exitCode: 0, signal: null, stdout, stderr: '' })
  const transport = {
    endpoint: 'u@h',
    cwd: '/home/u',
    getClient: async () => ({}) as never,
    getSftp: async () => ({ writeFile: (_path: string, _data: Buffer, cb: (error?: Error) => void) => cb() }),
    getRemoteEnvironment: async () => ({}),
    exec: async (command: string) => {
      commands.push(command)
      if (command === 'uname -s; uname -m') return outcome('Linux\nx86_64\n')
      if (command.includes('command -v rg')) return outcome('RG\nBWRAP\n')
      if (command.includes('dsh-core version')) {
        return outcome(`${JSON.stringify({ version: CORE_ARTIFACT_VERSION, arch: 'x86_64', proto: 1, caps: [] })}\n`)
      }
      return outcome()
    },
    resolveRemoteCwd: (cwd?: string) => cwd ?? '/home/u',
  }
  return { ...transport, commands } as SshTransport & { commands: string[] }
}

function gapCtx(options: {
  approval?: unknown
  initiator?: unknown
  transport?: unknown
}): Context {
  const ctx = new Context()
  if (options.approval !== null) ctx.provide('approval', options.approval)
  if (options.initiator !== null) ctx.provide('agents', { currentInitiator: () => options.initiator })
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? options.transport : undefined) })
  return ctx
}

test('asker: no approval service composed ⇒ false (fail closed, no deploy)', async () => {
  const ctx = gapCtx({ approval: null, initiator: { id: 'a1' }, transport: deployTransport() })
  const closed: string[] = []
  const ask = createCoreGapAsker(ctx, () => ({ close: (id: string) => { closed.push(id) } }) as never)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.deepEqual(closed, [])
})

test('asker: no initiating agent ⇒ false (outside a tool call nobody can answer)', async () => {
  const ctx = gapCtx({ approval: { request: async () => 'allowed-once' }, initiator: null })
  const ask = createCoreGapAsker(ctx, () => undefined)
  assert.equal(await ask('c1', { found: '0.0.1-old', expected: CORE_ARTIFACT_VERSION }), false)
})

test('asker: allowed-once deploys, closes stale serves, and reports the gap solved', async () => {
  const transport = deployTransport()
  const asks: Array<{ toolName: string; reason: string }> = []
  const ctx = gapCtx({
    approval: {
      request: async (req: { toolName: string; reason: string }) => {
        asks.push({ toolName: req.toolName, reason: req.reason })
        return 'allowed-once'
      },
    },
    initiator: { id: 'a1' },
    transport,
  })
  const closed: string[] = []
  const ask = createCoreGapAsker(ctx, () => ({ close: (id: string) => { closed.push(id) } }) as never)
  const solved = await ask('c1', { found: '0.0.1-old', expected: CORE_ARTIFACT_VERSION })
  assert.equal(solved, true)
  assert.equal(asks.length, 1)
  assert.equal(asks[0]?.toolName, CORE_DEPLOY_TOOL_NAME)
  assert.match(asks[0]?.reason ?? '', new RegExp(CORE_DEPLOY_ASK_MARKER.replace('[', '\\[').replace(']', '\\]')))
  assert.match(asks[0]?.reason ?? '', /0\.0\.1-old/)
  assert.match(asks[0]?.reason ?? '', new RegExp(CORE_ARTIFACT_VERSION.replaceAll('.', '\\.')))
  // The deploy ladder ran on the registry connection (real artifact on disk).
  assert.ok(transport.commands.some(command => command.includes('ln -sfn')), 'the install script ran')
  assert.deepEqual(closed, ['c1'], 'stale serves are dropped after the flip')
})

test('asker: a rejected ask deploys nothing', async () => {
  const transport = deployTransport()
  const ctx = gapCtx({
    approval: { request: async () => 'rejected' },
    initiator: { id: 'a1' },
    transport,
  })
  const ask = createCoreGapAsker(ctx, () => undefined)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.equal(transport.commands.length, 0)
})

test('asker: a failed deploy answers false (the hub keeps the fail-closed error)', async () => {
  const transport = deployTransport()
  // Break the ladder: uname refuses, deployCore returns ok:false before writing.
  const original = transport.exec
  transport.exec = async (command: string) => {
    if (command === 'uname -s; uname -m') {
      return { exitCode: 0, signal: null, stdout: 'Darwin\narm64\n', stderr: '' }
    }
    return await original(command)
  }
  const ctx = gapCtx({
    approval: { request: async () => 'allowed-once' },
    initiator: { id: 'a1' },
    transport,
  })
  const closed: string[] = []
  const ask = createCoreGapAsker(ctx, () => ({ close: (id: string) => { closed.push(id) } }) as never)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.deepEqual(closed, [])
})

test('asker: the ask reason is NOT the remote-gate marker (the AI answerer must not auto-grant it)', () => {
  const reason = coreDeployAskReason({ machineId: 'c1', found: undefined, expected: '0.2.2' })
  assert.ok(!reason.includes('[dsw-remote-gate]'))
  assert.match(reason, /not installed/)
})
