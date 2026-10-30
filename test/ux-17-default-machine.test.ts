/**
 * UX-17: the settings list can make this computer the default start.
 * The stored key stays `currentId`. `local` is not an SSH row, so it cannot
 * be edited or given a remote component.
 * @module test/ux-17-default-machine
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { isDefaultStart, LOCAL_MACHINE_ID, machineRowPolicy } from '../src/client/machine-list.ts'
import { LOCAL_SERVER_ID } from '../src/region-exec.ts'
import { SshRegistry } from '../src/registry.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function newRegistry(): { registry: SshRegistry; machinesFile: string; home: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-ux17-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  return { registry, machinesFile, home }
}

function openAgain(home: string): SshRegistry {
  return new SshRegistry(new Context(), {
    machinesFile: join(home, 'remote-workspaces', 'machines.json'),
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
}

test('UX-17: the local row can be the default and has no remote actions', () => {
  assert.equal(LOCAL_MACHINE_ID, LOCAL_SERVER_ID)
  const local = machineRowPolicy(LOCAL_MACHINE_ID)
  assert.equal(local.canSetDefault, true)
  assert.equal(local.canEdit, false)
  assert.equal(local.canDeploy, false)
  assert.equal(local.canDelete, false)
  assert.equal(local.canForgetKey, false)
  assert.equal(local.canCoreStatus, false)
  const remote = machineRowPolicy('c1')
  assert.equal(remote.canEdit, true)
  assert.equal(remote.canDeploy, true)
  assert.equal(remote.canDelete, true)
  assert.equal(remote.canForgetKey, true)
  assert.equal(remote.canCoreStatus, true)

  assert.equal(isDefaultStart('c1', 'c1', ['c1', 'c2']), true)
  assert.equal(isDefaultStart('c1', LOCAL_MACHINE_ID, ['c1', 'c2']), false)
  assert.equal(isDefaultStart('c1', 'c2', ['c1', 'c2']), false)
  assert.equal(isDefaultStart(LOCAL_MACHINE_ID, LOCAL_MACHINE_ID, ['c1']), true)
  assert.equal(isDefaultStart(LOCAL_MACHINE_ID, 'c1', ['c1']), false)
  assert.equal(isDefaultStart('', LOCAL_MACHINE_ID, ['c1']), true)
  assert.equal(isDefaultStart('gone', LOCAL_MACHINE_ID, ['c1']), true)
})

test('UX-17: setCurrent persists the local sentinel without a machine row', async () => {
  const { registry, machinesFile, home } = newRegistry()
  const saved = await registry.saveMachine({ host: 'h', username: 'u', label: 'remote' })
  assert.equal(registry.listMachines().currentId, saved.id)
  assert.equal(registry.setCurrent(LOCAL_MACHINE_ID), true)
  assert.equal(registry.setCurrent('missing'), false)

  const listed = registry.listMachines()
  assert.equal(listed.currentId, LOCAL_MACHINE_ID)
  assert.equal(listed.machines.some(machine => machine.id === LOCAL_MACHINE_ID), false)
  assert.equal(registry.get(LOCAL_MACHINE_ID), undefined)
  assert.equal(registry.activeSpec(), null)
  assert.equal(registry.getActive(), null)

  await sleep(40)
  const disk = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: Array<{ id: string }>; currentId: string }
  assert.equal(disk.currentId, LOCAL_MACHINE_ID)
  assert.equal(disk.list.some(machine => machine.id === LOCAL_MACHINE_ID), false)

  const again = openAgain(home)
  assert.equal(again.listMachines().currentId, LOCAL_MACHINE_ID)
  assert.equal(again.listMachines().machines.length, 1)
})

test('UX-17: an explicit local default survives a later save and a remote delete', async () => {
  const { registry } = newRegistry()
  const first = await registry.saveMachine({ host: 'h', username: 'u' })
  assert.equal(registry.setCurrent(LOCAL_MACHINE_ID), true)
  const second = await registry.saveMachine({ host: 'h2', username: 'u' })
  assert.notEqual(second.id, LOCAL_MACHINE_ID)
  assert.equal(registry.listMachines().currentId, LOCAL_MACHINE_ID)
  assert.equal(registry.remove(first.id), true)
  assert.equal(registry.listMachines().currentId, LOCAL_MACHINE_ID)
  assert.equal(registry.remove(LOCAL_MACHINE_ID), false)
  assert.equal(registry.setCurrent(second.id), true)
  assert.equal(registry.listMachines().currentId, second.id)
})

test('UX-17: the local id still cannot be saved as an SSH machine', async () => {
  const { registry } = newRegistry()
  await assert.rejects(
    () => registry.saveMachine({ id: LOCAL_MACHINE_ID, host: 'h', username: 'u' }),
    /reserved/,
  )
  assert.equal(registry.listMachines().machines.length, 0)
})
