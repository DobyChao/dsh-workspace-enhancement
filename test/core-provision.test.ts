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
  provisionRemoteCore,
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

function warmupHarness(machine: Record<string, never> | undefined, status: CoreStatusView, deployResult: CoreStatusView) {
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

test('warmup: an off-FIELD machine is still probed (confinement follows the session)', async () => {
  // 2026-09-30 lab fix: the machine field said 'off' while the user's session
  // fenced workspace-write — the field must not gate provisioning.
  const { warm, log } = warmupHarness({}, { ok: false }, { ok: true, version: CORE_ARTIFACT_VERSION })
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.equal(log.warns.length, 1)
})

test('warmup: a machine without a record (unknown) is skipped', async () => {
  const { warm, log } = warmupHarness(undefined, { ok: false }, { ok: true })
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(log.status.length, 0)
})

test('warmup: current artifact on disk stays silent (no warn, no deploy)', async () => {
  const { warm, log } = warmupHarness(
    {},
    { ok: true, version: CORE_ARTIFACT_VERSION },
    { ok: true },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.equal(log.deploys.length, 0)
  assert.equal(log.warns.length, 0)
})

// 2026-09-30 user decision: the background warmup runs outside any model
// turn, so it cannot ask — and a deploy that cannot ask must not deploy. It
// only probes and names the gap for the next tool-path provision.
test('warmup: a gap is PROBED and warned, never deployed (no turn ⇒ no ask ⇒ no deploy)', async () => {
  const { warm, log } = warmupHarness(
    {},
    { ok: true, version: '0.0.1-old' },
    { ok: true, version: CORE_ARTIFACT_VERSION },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(log.status, ['c1'])
  assert.deepEqual(log.deploys, [], 'the background probe never deploys')
  assert.deepEqual(log.closed, [])
  assert.equal(log.warns.length, 1)
  assert.match(log.warns[0] ?? '', /core gap on c1 \(0\.0\.1-old\)/)
})

test('warmup: a missing core is probed and warned as a gap', async () => {
  const { warm, log } = warmupHarness(
    {},
    { ok: false, detail: 'core not installed' },
    { ok: true },
  )
  warm('c1')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(log.deploys.length, 0)
  assert.equal(log.warns.length, 1)
  assert.match(log.warns[0] ?? '', /core gap on c1 \(not installed\)/)
})

test('warmup: concurrent triggers deduplicate to ONE probe run', async () => {
  const log: WarmupLog = { status: [], deploys: [], closed: [], warns: [] }
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  const warm = createCoreWarmup({
    machine: (id) => (id === 'c1' ? {} as never : undefined),
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
  assert.deepEqual(log.status, ['c1'], 'three racing triggers produce ONE probe')
  assert.deepEqual(log.deploys, [])
})

/* -------------------------------------------- REQ-I21: synchronous provision */

test('provisionRemoteCore: outcome ladder — skipped / current / deployed / failed', async () => {
  const mk = (
    machine: Record<string, never> | undefined,
    status: CoreStatusView,
    deployResult: CoreStatusView,
  ) => {
    const calls = { status: 0, deploy: 0, closed: 0 }
    const deps = {
      machine: (id: string) => (id === 'c1' ? machine as never : undefined),
      connection: (id: string) => (id === 'c1' ? ({} as SshTransport) : undefined),
      status: async (id: string) => { calls.status += 1; void id; return status },
      deploy: async (id: string) => { calls.deploy += 1; void id; return deployResult },
      afterDeploy: () => { calls.closed += 1 },
    }
    return { deps, calls }
  }

  // An off-FIELD machine still provisions (confinement is session-side);
  // only an UNKNOWN machine skips.
  const off = mk({}, { ok: true, version: CORE_ARTIFACT_VERSION }, { ok: true })
  assert.deepEqual(await provisionRemoteCore(off.deps, 'c1'), {
    id: 'c1', skipped: false, deployed: false, declined: false, version: CORE_ARTIFACT_VERSION, detail: undefined,
  })

  const unknown = mk(undefined, { ok: false }, { ok: true })
  const unknownOutcome = await provisionRemoteCore(unknown.deps, 'c1')
  assert.equal(unknownOutcome.skipped, true)
  assert.match(unknownOutcome.detail ?? '', /unknown machine/)
  assert.equal(unknown.calls.status, 0)

  const current = mk({}, { ok: true, version: CORE_ARTIFACT_VERSION }, { ok: true })
  assert.deepEqual(await provisionRemoteCore(current.deps, 'c1'), {
    id: 'c1', skipped: false, deployed: false, version: CORE_ARTIFACT_VERSION, declined: false, detail: undefined,
  })
  assert.equal(current.calls.deploy, 0)

  const stale = mk({}, { ok: true, version: '0.0.1-old' }, { ok: true, version: CORE_ARTIFACT_VERSION })
  const staleOutcome = await provisionRemoteCore(stale.deps, 'c1')
  assert.equal(staleOutcome.deployed, true)
  assert.equal(staleOutcome.version, CORE_ARTIFACT_VERSION)
  assert.equal(stale.calls.closed, 1, 'a successful deploy drops stale serves')

  // Version-gate width (2026-09-30): same major.minor is dependency-style
  // compatible — patch drift neither asks nor deploys.
  const patchDrift = mk({}, { ok: true, version: '0.2.9' }, { ok: true })
  assert.deepEqual(await provisionRemoteCore(patchDrift.deps, 'c1'), {
    id: 'c1', skipped: false, deployed: false, declined: false, version: '0.2.9', detail: undefined,
  })
  assert.equal(patchDrift.calls.deploy, 0)

  const failed = mk({}, { ok: false, detail: 'core not installed' }, { ok: false, detail: 'connection refused' })
  const failedOutcome = await provisionRemoteCore(failed.deps, 'c1')
  assert.equal(failedOutcome.deployed, false)
  assert.equal(failedOutcome.version, undefined)
  assert.match(failedOutcome.detail ?? '', /connection refused/)
  assert.equal(failed.calls.closed, 0)
})

// The user's three rules (2026-09-30): deploy attempts ask; a current core
// never asks; a declined ask deploys nothing and reports the kept state.
test('provisionRemoteCore: the approve gate — current never asks, declined never deploys, allowed deploys', async () => {
  const asks: Array<{ found: string | undefined }> = []
  const mkApproved = (allowed: boolean, status: CoreStatusView) => ({
    machine: () => ({}) as never,
    connection: () => ({} as SshTransport),
    status: async () => status,
    deploy: async () => ({ ok: true, version: CORE_ARTIFACT_VERSION }),
    approve: async (_id: string, facts: { found: string | undefined }) => {
      asks.push({ found: facts.found })
      return allowed
    },
  })

  const current = mkApproved(true, { ok: true, version: CORE_ARTIFACT_VERSION })
  assert.deepEqual(await provisionRemoteCore(current, 'c1'), {
    id: 'c1', skipped: false, deployed: false, declined: false, version: CORE_ARTIFACT_VERSION, detail: undefined,
  })
  assert.deepEqual(asks, [], 'a current core asks nothing')

  const declined = mkApproved(false, { ok: true, version: '0.0.1-old' })
  const declinedOutcome = await provisionRemoteCore(declined, 'c1')
  assert.equal(declinedOutcome.declined, true)
  assert.equal(declinedOutcome.deployed, false)
  assert.equal(declinedOutcome.version, '0.0.1-old', 'the kept disk state is reported')
  assert.deepEqual(asks, [{ found: '0.0.1-old' }])

  const allowed = mkApproved(true, { ok: false, detail: 'core not installed' })
  const allowedOutcome = await provisionRemoteCore(allowed, 'c1')
  assert.equal(allowedOutcome.deployed, true)
  assert.deepEqual(asks, [{ found: '0.0.1-old' }, { found: undefined }])
})

test('provisionRemoteCore: a throwing status becomes a thrown promise (the connect tool wraps it)', async () => {
  const deps = {
    machine: () => ({}) as never,
    connection: () => ({} as SshTransport),
    status: async () => { throw new Error('ssh dead') },
    deploy: async () => ({ ok: true }) as CoreStatusView,
  }
  await assert.rejects(() => provisionRemoteCore(deps, 'c1'), /ssh dead/)
})

/* ------------------------------------------------- first-use approval ask */

/** Records what the injected deploy saw; the real deployCore ladder is covered by test/core-deploy. */
function fakeDeploy(results: Array<{ ok: boolean; version?: string; detail?: string }>) {
  const transports: unknown[] = []
  const deploy = async (transport: unknown): Promise<CoreStatusView> => {
    transports.push(transport)
    return results[transports.length - 1] ?? { ok: true, version: CORE_ARTIFACT_VERSION }
  }
  return { deploy: deploy as never, transports }
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
  const ctx = gapCtx({ approval: null, initiator: { id: 'a1' }, transport: {} })
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

test('asker: allowed-once deploys on the registry connection, closes stale serves, reports solved', async () => {
  const registryTransport = { endpoint: 'u@h' }
  const { deploy, transports } = fakeDeploy([{ ok: true, version: CORE_ARTIFACT_VERSION }])
  const asks: Array<{ toolName: string; reason: string }> = []
  const ctx = gapCtx({
    approval: {
      request: async (req: { toolName: string; reason: string }) => {
        asks.push({ toolName: req.toolName, reason: req.reason })
        return 'allowed-once'
      },
    },
    initiator: { id: 'a1' },
    transport: registryTransport,
  })
  const closed: string[] = []
  const ask = createCoreGapAsker(ctx, () => ({ close: (id: string) => { closed.push(id) } }) as never, deploy)
  const solved = await ask('c1', { found: '0.0.1-old', expected: CORE_ARTIFACT_VERSION })
  assert.equal(solved, true)
  assert.equal(asks.length, 1)
  assert.equal(asks[0]?.toolName, CORE_DEPLOY_TOOL_NAME)
  assert.match(asks[0]?.reason ?? '', new RegExp(CORE_DEPLOY_ASK_MARKER.replace('[', '\\[').replace(']', '\\]')))
  assert.match(asks[0]?.reason ?? '', /0\.0\.1-old/)
  assert.match(asks[0]?.reason ?? '', new RegExp(CORE_ARTIFACT_VERSION.replaceAll('.', '\\.')))
  assert.deepEqual(transports, [registryTransport], 'the deploy runs on the registry connection')
  assert.deepEqual(closed, ['c1'], 'stale serves are dropped after the flip')
})

test('asker: a rejected ask deploys nothing', async () => {
  const { deploy, transports } = fakeDeploy([{ ok: true }])
  const ctx = gapCtx({
    approval: { request: async () => 'rejected' },
    initiator: { id: 'a1' },
    transport: {},
  })
  const ask = createCoreGapAsker(ctx, () => undefined, deploy)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.equal(transports.length, 0)
})

test('asker: a failed deploy answers false (the hub keeps the fail-closed error)', async () => {
  const { deploy } = fakeDeploy([{ ok: false, detail: 'connection refused' }])
  const ctx = gapCtx({
    approval: { request: async () => 'allowed-once' },
    initiator: { id: 'a1' },
    transport: {},
  })
  const closed: string[] = []
  const ask = createCoreGapAsker(ctx, () => ({ close: (id: string) => { closed.push(id) } }) as never, deploy)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.deepEqual(closed, [], 'a failed deploy must not drop serves')
})

test('asker: an ask whose request throws (no open turn) answers false without deploying', async () => {
  const { deploy, transports } = fakeDeploy([{ ok: true }])
  const ctx = gapCtx({
    approval: { request: async () => { throw new Error('no open turn') } },
    initiator: { id: 'a1' },
    transport: {},
  })
  const ask = createCoreGapAsker(ctx, () => undefined, deploy)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.equal(transports.length, 0)
})

test('asker: the ask reason is NOT the remote-gate marker (the AI answerer must not auto-grant it)', () => {
  const reason = coreDeployAskReason({ machineId: 'c1', found: undefined, expected: '0.2.2' })
  assert.ok(!reason.includes('[dsw-remote-gate]'))
  assert.match(reason, /not installed/)
})
