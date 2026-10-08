/**
 * AUDIT-7: the per-machine `remoteSandbox` field is removed from registry
 * views and persistence; legacy JSON must load and strip on save.
 * @module test/registry-remote-sandbox-legacy
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SshRegistry from '../src/registry.ts'
import { EMPTY_MACHINE_FORM, machinePayload } from '../src/client/machine-payload.ts'

test('registry: legacy remoteSandbox in machines.json loads without a view field and strips on save', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-audit7-legacy-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(machinesFile, JSON.stringify({
    list: [{
      id: 'c1',
      label: 'h1',
      host: 'h1',
      port: 22,
      username: 'u',
      remoteSandbox: 'workspace-write',
    }],
    currentId: 'c1',
  }), 'utf8')

  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })

  const loaded = registry.listMachines().machines[0]
  assert.ok(loaded !== undefined)
  assert.equal('remoteSandbox' in (loaded as object), false, 'the machine view omits the dead field')

  await registry.saveMachine({ id: 'c1', host: 'h1', username: 'u' })
  await new Promise(resolve => setTimeout(resolve, 30))

  const persisted = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: Array<Record<string, unknown>> }
  assert.equal('remoteSandbox' in (persisted.list[0] as object), false, 'save rewrites JSON without the legacy key')
})

test('machine payload: UI omits remoteApproval and remoteSandbox (registry defaults stay server-side)', () => {
  const payload = machinePayload({ ...EMPTY_MACHINE_FORM, host: 'h', username: 'u' })
  assert.equal('remoteApproval' in payload, false)
  assert.equal('remoteSandbox' in payload, false)
})
