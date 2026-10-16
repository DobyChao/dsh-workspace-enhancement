/**
 * UX-13: ssh-config host rows in the add-workspace panel pick a probe target.
 * A saved match shares that connection's scheduler id. Anything else goes to
 * config.probe and is not written into the registry.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configProbeId } from '../src/config-probe.ts'
import { configHostProbeTarget, configHostRpc } from '../src/client/config-host-status.ts'

const c1 = { alias: 'c1', host: '10.0.0.8', port: 22 }
const saved = { id: 'm1', host: 'c1', port: 22 }

test('UX-13: a config host that matches a saved connection reuses that id', () => {
  const byAlias = configHostProbeTarget(c1, [saved])
  assert.deepEqual(byAlias, { id: 'm1', kind: 'saved' })
  const byHostName = configHostProbeTarget(c1, [{ id: 'm2', host: '10.0.0.8', port: 22 }])
  assert.equal(byHostName.kind, 'saved')
  assert.equal(byHostName.id, 'm2')
  const differentPort = configHostProbeTarget(c1, [{ id: 'm3', host: 'c1', port: 2222 }])
  assert.equal(differentPort.kind, 'config')
  assert.equal(differentPort.id, configProbeId('c1'))
})

test('UX-13: an unmatched config host probes config.probe and does not use conn.probe', async () => {
  const target = configHostProbeTarget({ alias: 'c2', host: '10.0.0.9', port: 22 }, [])
  assert.equal(target.kind, 'config')
  assert.equal(target.id, 'config:c2')
  const calls: string[] = []
  const rpc = (endpoint: string, payload?: unknown) => {
    calls.push(`${endpoint}:${JSON.stringify(payload)}`)
    return Promise.resolve({ ok: true, value: null })
  }
  const wrapped = configHostRpc(rpc, target)
  await wrapped('conn.probe', { id: 'config:c2' })
  await wrapped('conn.reconnect', { id: 'config:c2' })
  await wrapped('conn.status', { id: 'config:c2' })
  await wrapped('connections.list', {})
  assert.deepEqual(calls, [
    'config.probe:{"alias":"c2"}',
    'config.probe:{"alias":"c2"}',
    'config.probe:{"alias":"c2"}',
    'connections.list:{}',
  ])
  const savedRpc = configHostRpc(rpc, { id: 'm1', kind: 'saved' })
  assert.equal(savedRpc, rpc)
})
