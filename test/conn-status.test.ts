/**
 * Connection status regression tests (t3): the pure tri-state derivation, the
 * registry's statusOf/probe/reconnect endpoints over a substituted (fake)
 * live connection, the probe-result TTL cache with expiry, and the
 * failed-connection-cache root fix on SshSession (a failed `ready` attempt is
 * never cached — the next getClient retries).
 * @module test/conn-status
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SshRegistry, deriveConnectionState } from '../src/registry.ts'
import type { ConnectionStatusView, ProbedConnection, RegistryConfig } from '../src/registry.ts'
import { SshSession } from '../src/ssh-core.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import type { SshConnection, SshConnectionSpec } from '../src/connection.ts'
import type { Client } from 'ssh2'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** A registry whose connections are substituted by a scripted fake. */
class TestRegistry extends SshRegistry {
  constructor(ctx: Context, config: RegistryConfig, private readonly makeFake: (spec: SshConnectionSpec) => SshConnection) {
    super(ctx, config)
  }
  protected override fabricateConnection(spec: SshConnectionSpec): SshConnection {
    return this.makeFake(spec)
  }
}

function baseConfig(home: string, statusTtlMs?: number): RegistryConfig {
  return {
    machinesFile: join(home, 'remote-workspaces', 'machines.json'),
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
    ...(statusTtlMs !== undefined ? { statusTtlMs } : {}),
  }
}

/** One scripted fake live connection (structural subset; exec is overridable). */
function fakeConnection(overrides: {
  connected?: boolean
  exec?: () => Promise<ExecOutcome>
  onDispose?: () => void
}): { connection: SshConnection; disposed: () => boolean } {
  let disposed = false
  const connection = {
    isConnected: () => overrides.connected ?? false,
    exec: () => overrides.exec !== undefined
      ? overrides.exec()
      : Promise.resolve({ exitCode: 0, signal: null, stdout: 'ok\n', stderr: '' }),
    dispose: () => {
      disposed = true
      overrides.onDispose?.()
    },
  } satisfies ProbedConnection
  return { connection: connection as unknown as SshConnection, disposed: () => disposed }
}

test('deriveConnectionState: pure tri-state table', () => {
  assert.equal(deriveConnectionState(false, false, false), 'unknown')
  assert.equal(deriveConnectionState(false, true, false), 'unknown') // no chain — still unknown
  assert.equal(deriveConnectionState(true, true, false), 'active')
  assert.equal(deriveConnectionState(true, false, false), 'offline')
  assert.equal(deriveConnectionState(true, true, true), 'offline') // failed probe outranks
  assert.equal(deriveConnectionState(false, false, true), 'offline')
})

test('statusOf: unknown → active → offline with a live chain', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-status-'))
  const registry = new TestRegistry(new Context(), baseConfig(home), () => fakeConnection({ connected: true }).connection)
  const machine = await registry.saveMachine({ host: 'h', username: 'u', label: 'm1' })
  const id = machine.id
  // No live chain yet → unknown.
  let status = registry.statusOf(id)
  assert.equal(status?.state, 'unknown')
  assert.equal(status?.hostKeyKnown, false)
  // First use fabricates the fake (connected) → active.
  registry.get(id)
  status = registry.statusOf(id)
  assert.equal(status?.state, 'active')
  assert.equal(status?.connected, true)
  // Unknown id → undefined.
  assert.equal(registry.statusOf('missing'), undefined)
})

test('statusOf: an unready live chain reports offline', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sw-status2-'))
  const registry = new TestRegistry(new Context(), baseConfig(home), () => fakeConnection({ connected: false }).connection)
  const machine = await registry.saveMachine({ host: 'h', username: 'u' })
  registry.get(machine.id)
  const status = registry.statusOf(machine.id)
  assert.equal(status?.state, 'offline')
})

test('probe: success reports active, records latency, and persists lastProbeAt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sw-probe-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new TestRegistry(new Context(), baseConfig(home), () => fakeConnection({ connected: true }).connection)
  const machine = await registry.saveMachine({ host: 'h', username: 'u' })
  const viewed = await registry.probe(machine.id)
  assert.equal(viewed.state, 'active')
  assert.equal(viewed.connected, true)
  assert.equal(typeof viewed.lastProbeAt, 'string')
  assert.equal(typeof viewed.lastProbeLatencyMs, 'number')
  // The probe result is cached but a fresh statusOf agrees.
  const cached = registry.statusOf(machine.id)
  assert.equal(cached?.state, 'active')
  // Durable record: lastProbeAt lands in machines.json (persist is serialized).
  await sleep(20)
  const persistedList = JSON.parse(readFileSync(machinesFile, 'utf8')).list as Array<Record<string, unknown>>
  assert.equal(typeof persistedList[0]?.lastProbeAt, 'string')
})

test('probe: a failing round-trip reports offline with the message', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sw-probe2-'))
  const registry = new TestRegistry(new Context(), baseConfig(home), () => fakeConnection({
    exec: () => Promise.reject(new Error('ssh: handshake failed')),
  }).connection)
  const machine = await registry.saveMachine({ host: 'h', username: 'u' })
  const viewed = await registry.probe(machine.id)
  assert.equal(viewed.state, 'offline')
  assert.match(viewed.message ?? '', /handshake failed/)
})

test('status cache expires: a cached offline message does not outlive the TTL', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sw-ttl-'))
  const registry = new TestRegistry(new Context(), baseConfig(home, 40), () => fakeConnection({
    connected: false,
    exec: () => Promise.reject(new Error('boom')),
  }).connection)
  const machine = await registry.saveMachine({ host: 'h', username: 'u' })
  const probed = await registry.probe(machine.id)
  assert.equal(probed.state, 'offline')
  assert.equal(probed.message, 'boom')
  // Fresh: the cached failed outcome (with its message) is served.
  const fresh = registry.statusOf(machine.id)
  assert.equal(fresh?.state, 'offline')
  assert.equal(fresh?.message, 'boom')
  // Expired: derived from the live chain alone — offline, no stale message.
  await sleep(90)
  const expired = registry.statusOf(machine.id)
  assert.equal(expired?.state, 'offline')
  assert.equal(expired?.message, undefined)
})

test('reconnect: disposes the poisoned chain, rebuilds, and probes the result', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-sw-reconnect-'))
  const stale = fakeConnection({ connected: false, exec: () => Promise.reject(new Error('poisoned cached failure')) })
  const fresh = fakeConnection({ connected: true })
  const fakes = [stale.connection, fresh.connection]
  const registry = new TestRegistry(new Context(), baseConfig(home, 0), () => {
    const next = fakes.shift()
    if (next === undefined) throw new Error('no more fakes')
    return next
  })
  const machine = await registry.saveMachine({ host: 'h', username: 'u' })
  // A first failed probe caches the poisoned chain.
  const first = await registry.probe(machine.id)
  assert.equal(first.state, 'offline')
  assert.equal(stale.disposed(), false)
  // Reconnect disposes the old chain and probes a fresh one.
  const result = await registry.reconnect(machine.id)
  assert.equal(stale.disposed(), true)
  assert.equal(result.state, 'active')
  // The live chain is the rebuilt one (fresh connected → active statusOf).
  const after = registry.statusOf(machine.id)
  assert.equal(after?.state, 'active')
  assert.equal(after?.message, undefined)
})

test('SshSession: a failed ready attempt is not cached — the next getClient retries', async () => {
  const session = new SshSession(
    [{ host: '127.0.0.1', port: 22, username: 'x' }],
    false,
    [],
    {},
  ) as unknown as {
    open: () => Promise<Client>
    ready: Promise<Client> | undefined
    getClient(signal?: AbortSignal): Promise<Client>
  }
  let attempts = 0
  session.open = async () => {
    attempts += 1
    throw new Error('boom')
  }
  await assert.rejects(session.getClient(), /boom/)
  assert.equal(session.ready, undefined) // the failed attempt was dropped
  await assert.rejects(session.getClient(), /boom/)
  assert.equal(attempts, 2) // the second call really retried
})
