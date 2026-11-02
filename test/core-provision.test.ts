/**
 * REQ-I14: connection warmup (panel connect probes, it does not upload)
 * and the first-use gap deploy (missing/stale disk artifact → deployCore → hub close).
 * @module test/core-provision
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CORE_ARTIFACT_VERSION } from '../src/core-protocol.ts'
import {
  createCoreGapAsker,
  createCoreWarmup,
  provisionRemoteCore,
} from '../src/core-provision.ts'
import type { CoreStatusView } from '../src/core-hub.ts'
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

// 2026-10-29 (BUG-26): panel/channel connect only probes. The upload is
// sw_connect or a confined first use, and neither asks.
test('warmup: a gap is PROBED and warned, never deployed from the panel path', async () => {
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

test('provisionRemoteCore: an unknown sha256 on the same version line is replaced', async () => {
  let deployed = 0
  const outcome = await provisionRemoteCore({
    machine: () => ({}) as never,
    connection: () => ({} as SshTransport),
    status: async () => ({ ok: true, version: CORE_ARTIFACT_VERSION, sha256: '11'.repeat(32) }),
    deploy: async () => {
      deployed += 1
      return { ok: true, version: CORE_ARTIFACT_VERSION }
    },
  }, 'c1')
  assert.equal(deployed, 1)
  assert.equal(outcome.deployed, true)
})

test('provisionRemoteCore: a missing core deploys without an approval callback', async () => {
  let deployed = 0
  const outcome = await provisionRemoteCore({
    machine: () => ({}) as never,
    connection: () => ({} as SshTransport),
    status: async () => ({ ok: false, detail: 'core not installed' }),
    deploy: async () => {
      deployed += 1
      return { ok: true, version: CORE_ARTIFACT_VERSION }
    },
  }, 'c1')
  assert.equal(deployed, 1)
  assert.equal(outcome.deployed, true)
  assert.equal(outcome.declined, false)
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

/* ---------------------------------------------------- first-use gap deploy */

/** Records what the injected deploy saw; the real deployCore ladder is covered by test/core-deploy. */
function fakeDeploy(results: Array<{ ok: boolean; version?: string; detail?: string }>) {
  const transports: unknown[] = []
  const deploy = async (transport: unknown): Promise<CoreStatusView> => {
    transports.push(transport)
    return results[transports.length - 1] ?? { ok: true, version: CORE_ARTIFACT_VERSION }
  }
  return { deploy: deploy as never, transports }
}

function gapCtx(transport: unknown): Context {
  const ctx = new Context()
  ctx.provide('sshRegistry', { get: (id: string) => (id === 'c1' ? transport : undefined) })
  return ctx
}

test('gap: no registry connection ⇒ false, nothing deployed', async () => {
  const { deploy, transports } = fakeDeploy([{ ok: true }])
  const ask = createCoreGapAsker(gapCtx(undefined), () => undefined, deploy)
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.equal(transports.length, 0)
})

test('gap: a missing core deploys on the registry connection and drops stale serves', async () => {
  const registryTransport = { endpoint: 'u@h' }
  const { deploy, transports } = fakeDeploy([{ ok: true, version: CORE_ARTIFACT_VERSION }])
  const closed: string[] = []
  const ask = createCoreGapAsker(
    gapCtx(registryTransport),
    () => ({ close: (id: string) => { closed.push(id) } }) as never,
    deploy,
  )
  const solved = await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION })
  assert.equal(solved, true)
  assert.deepEqual(transports, [registryTransport], 'the deploy runs on the registry connection')
  assert.deepEqual(closed, ['c1'], 'stale serves are dropped after the flip')
})

test('gap: a failed deploy answers false (the hub keeps the fail-closed error)', async () => {
  const { deploy } = fakeDeploy([{ ok: false, detail: 'connection refused' }])
  const closed: string[] = []
  const ask = createCoreGapAsker(
    gapCtx({}),
    () => ({ close: (id: string) => { closed.push(id) } }) as never,
    deploy,
  )
  assert.equal(await ask('c1', { found: undefined, expected: CORE_ARTIFACT_VERSION }), false)
  assert.deepEqual(closed, [], 'a failed deploy must not drop serves')
})
