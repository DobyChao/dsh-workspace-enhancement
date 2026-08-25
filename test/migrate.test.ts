/**
 * Migration unit tests: dsh-ssh-connections.json → machines.json first-run
 * import (ids and resources preserved) plus the legacy `.bak` rename, and the
 * tolerant loading of an existing dsh-remote-shaped machines.json.
 * @module test/migrate
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadMachinesState, normalizeMachine } from '../src/registry.ts'

/** Create a temp home and the legacy state file with the given connections. */
function legacyHome(connections: unknown[]): { home: string; machinesFile: string; legacyFile: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-migrate-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const legacyFile = join(home, 'dsh-ssh-connections.json')
  writeFileSync(legacyFile, JSON.stringify({ connections }, null, 2), 'utf8')
  return { home, machinesFile, legacyFile }
}

const warnings: string[] = []
const warn = (message: string): void => { warnings.push(message) }

test('first run imports dsh-ssh-connections.json into machines.json and renames the legacy file', () => {
  const { home, machinesFile, legacyFile } = legacyHome([
    {
      id: 'c1',
      label: 'lab box',
      name: 'lab',
      host: '127.0.0.1',
      port: 22,
      username: 'uuz',
      password: 'secret',
      privateKeyPath: 'C:\\Users\\uuz\\.ssh\\id_ed25519',
      passphrase: '',
      agent: '',
      jump: [
        { host: 'bastion', port: 2222, username: 'jump', privateKey: 'C:\\Users\\uuz\\.ssh\\bastion' },
      ],
      cwd: '/home/uuz/project',
      strictHostKeyChecking: false,
      knownHosts: ['SHA256:abc'],
      readyTimeout: 45000,
    },
  ])

  const state = loadMachinesState(machinesFile, legacyFile, warn)

  // Imported verbatim: id c1 preserved, resources kept.
  assert.equal(state.migrated, true)
  assert.equal(state.currentId, 'c1')
  assert.equal(state.list.length, 1)
  const c1 = state.list[0] as Record<string, unknown>
  assert.equal(c1.id, 'c1')
  assert.equal(c1.label, 'lab box')
  assert.equal(c1.name, 'lab')
  assert.equal(c1.host, '127.0.0.1')
  assert.equal(c1.port, 22)
  assert.equal(c1.username, 'uuz')
  assert.equal(c1.password, 'secret')
  assert.equal(c1.privateKeyPath, 'C:\\Users\\uuz\\.ssh\\id_ed25519')
  assert.equal(c1.cwd, '/home/uuz/project')
  assert.deepEqual(c1.knownHosts, ['SHA256:abc'])
  assert.equal(c1.readyTimeout, 45000)
  assert.ok(Array.isArray(c1.jump))
  assert.equal((c1.jump as Array<Record<string, unknown>>)[0]?.host, 'bastion')
  assert.equal((c1.jump as Array<Record<string, unknown>>)[0]?.port, 2222)
  assert.equal((c1.jump as Array<Record<string, unknown>>)[0]?.privateKey, 'C:\\Users\\uuz\\.ssh\\bastion')

  // machines.json exists with the dsh-remote {list, currentId} shape.
  assert.ok(existsSync(machinesFile))
  const persisted = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: unknown[]; currentId: string }
  assert.equal(persisted.currentId, 'c1')
  assert.equal(persisted.list.length, 1)
  assert.equal((persisted.list[0] as { id: string }).id, 'c1')

  // The legacy file was renamed to .bak, so a second run never re-imports.
  assert.equal(existsSync(legacyFile), false)
  assert.ok(existsSync(`${legacyFile}.bak`))

  // Second run: machines.json wins, nothing is re-imported.
  const again = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(again.migrated, false)
  assert.equal(again.list.length, 1)
  assert.equal(again.currentId, 'c1')

  // No mirror/sync artifacts are created by the migration.
  assert.equal(existsSync(join(home, 'remote-workspaces', 'forwards.json')), false)
  assert.equal(existsSync(join(home, 'remote-workspaces', 'audit.log')), false)
})

test('a corrupt or empty legacy file starts empty and never renames', () => {
  const { home, machinesFile, legacyFile } = legacyHome([{ id: 'broken' }]) // missing host/username
  const state = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(state.migrated, false)
  assert.equal(state.list.length, 0)
  assert.equal(state.currentId, null)
  assert.equal(existsSync(machinesFile), false)
  assert.equal(existsSync(legacyFile), true) // still in place for the operator
  assert.equal(existsSync(`${legacyFile}.bak`), false)
  assert.equal(home.length > 0, true)
})

test('a dsh-remote-era EMPTY machines.json does not block the legacy import (B-迁移守卫)', () => {
  const { home, machinesFile, legacyFile } = legacyHome([{
    id: 'c1',
    label: 'lab box',
    host: '127.0.0.1',
    port: 22,
    username: 'uuz',
    cwd: '/home/uuz',
  }])
  // dsh-remote leftovers: the empty machine table sits in place of no file.
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(machinesFile, JSON.stringify({ list: [], currentId: null }), 'utf8')

  const state = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(state.migrated, true)
  assert.equal(state.list.length, 1)
  assert.equal(state.list[0]?.id, 'c1') // imported
  assert.equal(state.currentId, 'c1') // first imported connection becomes current
  const persisted = JSON.parse(readFileSync(machinesFile, 'utf8')) as { list: unknown[]; currentId: string }
  assert.equal(persisted.currentId, 'c1') // empty table replaced by the import
  assert.equal((persisted.list[0] as { id: string }).id, 'c1')
  assert.equal(existsSync(legacyFile), false) // renamed
  assert.ok(existsSync(`${legacyFile}.bak`))
  assert.equal(home.length > 0, true)
})

test('a non-empty machines.json is never overridden by the legacy import (guard preserved)', () => {
  const { home, machinesFile, legacyFile } = legacyHome([{ id: 'c1', label: 'old', host: 'h', port: 22, username: 'u', cwd: '/' }])
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(machinesFile, JSON.stringify({
    currentId: 'm-9',
    list: [{ id: 'm-9', label: 'prod', host: '10.0.0.1', port: 22, username: 'deploy' }],
  }), 'utf8')

  const state = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(state.migrated, false)
  assert.equal(state.list.length, 1)
  assert.equal(state.list[0]?.id, 'm-9') // existing registry wins
  assert.equal(state.currentId, 'm-9')
  assert.equal(existsSync(machinesFile), true)
  assert.equal(existsSync(legacyFile), true) // legacy untouched, no .bak
  assert.equal(existsSync(`${legacyFile}.bak`), false)
  assert.equal(home.length > 0, true)
})

test('an empty machines.json with no legacy file stays empty (no .bak, no write)', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-empty-table-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const legacyFile = join(home, 'dsh-ssh-connections.json')
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  const original = JSON.stringify({ list: [], currentId: null }, null, 2)
  writeFileSync(machinesFile, original, 'utf8')

  const state = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(state.migrated, false)
  assert.equal(state.list.length, 0)
  assert.equal(state.currentId, null)
  assert.equal(readFileSync(machinesFile, 'utf8'), original) // untouched
  assert.equal(existsSync(legacyFile), false)
  assert.equal(existsSync(`${legacyFile}.bak`), false)
  assert.equal(home.length > 0, true)
})

test('an existing dsh-remote machines.json loads with its record normalized', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-normalize-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const legacyFile = join(home, 'dsh-ssh-connections.json')
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(machinesFile, JSON.stringify({
    currentId: 'm-1',
    list: [
      {
        id: 'm-1',
        name: 'prod',
        host: '10.0.0.1',
        port: 2222,
        username: 'deploy',
        password: '',
        workspace: '/srv/app',
        hostKeyMode: 'verify',
        useAgent: false,
        proxy: { host: 'bastion', port: 22, username: 'jump', password: 'pw', privateKeyPath: '' },
        recentWorkspaces: ['/srv/app', '/srv/other', '/x', '/y', '/z', '/a', '/b', '/c', '/d', '/e'],
        credentialBackend: 'plain',
      },
    ],
  }, null, 2), 'utf8')

  const state = loadMachinesState(machinesFile, legacyFile, warn)
  assert.equal(state.migrated, false)
  assert.equal(state.currentId, 'm-1')
  const machine = state.list[0] as Record<string, unknown>
  assert.equal(machine.id, 'm-1')
  // dsh-remote `name` becomes the label fallback.
  assert.equal(machine.label, 'prod')
  // dsh-remote `workspace` is preserved.
  assert.equal(machine.workspace, '/srv/app')
  assert.equal(machine.hostKeyMode, 'verify')
  assert.equal(machine.credentialBackend, 'plain')
  // `proxy` normalizes into a one-hop jump chain.
  assert.ok(Array.isArray(machine.jump))
  assert.equal((machine.jump as Array<Record<string, unknown>>)[0]?.host, 'bastion')
  assert.equal((machine.jump as Array<Record<string, unknown>>)[0]?.username, 'jump')
  // recentWorkspaces is capped at 8, most recent first.
  assert.deepEqual(machine.recentWorkspaces, ['/srv/app', '/srv/other', '/x', '/y', '/z', '/a', '/b', '/c'])
  assert.equal(home.length > 0, true)
})

test('normalizeMachine keeps a legacy dsh-ssh record shape with empty optional strings dropped', () => {
  const machine = normalizeMachine({
    id: 'c2',
    label: 'plain',
    host: 'h',
    port: 22,
    username: 'u',
    password: '',
    passphrase: '',
    agent: '',
    cwd: '',
    strictHostKeyChecking: false,
  })
  assert.ok(machine !== null)
  assert.equal(machine.id, 'c2')
  assert.equal(machine.label, 'plain')
  assert.equal('password' in machine, false)
  assert.equal('cwd' in machine, false)
  assert.equal(machine.strictHostKeyChecking, false)
})
