/**
 * Registry view/persist regression tests (B2/B3/B4): an empty password is never
 * persisted (`''` = unset), the auth projection reports `key` for
 * private-key machines / keychain-flag machines without a stored password
 * (passwordSet requires an actual stored password), and an encryption request
 * that fell back to plaintext carries an honest view marker (B4).
 * @module test/registry-view
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SshRegistry, mergeTestFields } from '../src/registry.ts'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function newRegistry(): { registry: SshRegistry; machinesFile: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-view-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  return { registry, machinesFile }
}

function persisted(machinesFile: string): Record<string, unknown> {
  return JSON.parse(readFileSync(machinesFile, 'utf8')) as Record<string, unknown>
}

test('B2: a machine without a password persists no password field at all', async () => {
  const { registry, machinesFile } = newRegistry()
  const view = await registry.saveMachine({ host: 'h1', username: 'u' })
  assert.equal(view.passwordSet, false)
  assert.equal(view.auth, 'key')
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal('password' in (list[0] as object), false)
})

test('B2: a keychain machine (flag, no password) persists no password field', async () => {
  const { registry, machinesFile } = newRegistry()
  const view = await registry.saveMachine({ host: 'h2', username: 'u', credentialBackend: 'keychain' })
  assert.equal(view.passwordSet, false)
  assert.equal(view.auth, 'key')
  assert.equal(view.credentialBackend, 'keychain') // the 🗝 marker still shows
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal('password' in (list[0] as object), false)
})

test('B3: private-key machines report key auth even without a password', async () => {
  const { registry } = newRegistry()
  const view = await registry.saveMachine({ host: 'h3', username: 'u', privateKeyPath: 'C:\\u\\.ssh\\id_ed25519' })
  assert.equal(view.auth, 'key')
  assert.equal(view.passwordSet, false)
  // The legacy connections.list projection agrees.
  assert.equal(registry.list()[0]?.auth, 'key')
})

test('B3: a machine with a real password reports password auth', async () => {
  const { registry } = newRegistry()
  const view = await registry.saveMachine({ host: 'h4', username: 'u', password: 'pw' })
  assert.equal(view.auth, 'password')
  assert.equal(view.passwordSet, true)
  assert.equal(registry.list()[0]?.auth, 'password')
})

test('B3: agent machines still report agent auth', async () => {
  const { registry } = newRegistry()
  const view = await registry.saveMachine({ host: 'h5', username: 'u', agent: 'pageant' })
  assert.equal(view.auth, 'agent')
})

test('B4: encryption request with a failing OS backend marks the view as plaintext fallback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-fallback-'))
  const secretsDir = join(home, 'remote-workspaces', '.secrets')
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  // A FILE at the secrets dir path blocks mkdir, forcing saveSecret to fail —
  // deterministic best-effort fallback on every platform.
  writeFileSync(secretsDir, 'not a directory', 'utf8')
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir,
  })
  const view = await registry.saveMachine({ host: 'fb1', username: 'u', password: 'swordfish', encryptPassword: true })
  assert.equal(view.credentialBackend, 'plain') // the actual (fallback) result
  assert.equal(view.encryptFallback, true) // honest marker the UI warns on
  assert.equal(view.passwordSet, true) // plaintext fallback preserved the password
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal(list[0]?.password, 'swordfish') // plaintext kept, with the ⚠ marker
  assert.equal(list[0]?.encryptFallback, true)
})

test('B4: key-based machine ticking encrypt without a password creates no phantom backend or warning', async () => {
  const { registry } = newRegistry()
  const view = await registry.saveMachine({ host: 'fb2', username: 'u', encryptPassword: true })
  assert.equal(view.credentialBackend, 'plain') // nothing to encrypt → stays plain
  assert.equal(view.encryptFallback, undefined) // no warning
  assert.equal(view.passwordSet, false)
})

/* ---------------- P2-④: secret-free edit keeps the machine's key auth ---------------- */

test('P2-④: saving a key machine WITHOUT privateKeyPath keeps the stored key (view + disk)', async () => {
  const { registry, machinesFile } = newRegistry()
  const path = 'C:\\u\\.ssh\\id_ed25519'
  const created = await registry.saveMachine({ host: 'k1', username: 'u', label: 'old', privateKeyPath: path, passphrase: 'pp' })
  // The edit form is secret-free: it omits the key/passphrase entirely.
  const updated = await registry.saveMachine({ id: created.id, host: 'k1', username: 'u', label: 'new' })
  assert.equal(updated.auth, 'key')
  assert.equal(registry.list()[0]?.auth, 'key')
  await sleep(20) // persist() is fire-and-forget on a serialized write queue
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal(list[0]?.privateKeyPath, path)
  assert.equal(list[0]?.passphrase, 'pp')
  // An explicitly typed replacement still applies.
  const replaced = await registry.saveMachine({ id: created.id, host: 'k1', username: 'u', privateKeyPath: 'C:\\u\\.ssh\\id_rsa' })
  assert.equal(replaced.auth, 'key')
  await sleep(20)
  const list2 = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal(list2[0]?.privateKeyPath, 'C:\\u\\.ssh\\id_rsa')
})

test('P2-④: an update keeps stored jump and agent fields when the payload omits them', async () => {
  const { registry, machinesFile } = newRegistry()
  const created = await registry.saveMachine({
    host: 'k2', username: 'u', agent: 'pageant',
    jump: [{ host: 'bastion', port: 2202, username: 'jump' }],
  })
  const updated = await registry.saveMachine({ id: created.id, host: 'k2', username: 'u', label: 'renamed' })
  assert.equal(updated.auth, 'agent')
  assert.equal(updated.jumpHosts.length, 1)
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal(list[0]?.agent, 'pageant')
  assert.equal((list[0]?.jump as Array<Record<string, unknown>>)[0]?.host, 'bastion')
})

test('P2-④: mergeTestFields — explicit input wins, an omitted field falls back to prev', () => {
  const prev = {
    privateKeyPath: 'C:\\u\\.ssh\\id_ed25519',
    passphrase: 'pp',
    agent: undefined,
    jump: [{ host: 'bastion', port: 2202, username: 'jump' }],
  }
  // Secret-free edit: everything omitted → stored values used (key auth kept).
  let merged = mergeTestFields({}, prev)
  assert.equal(merged.privateKeyPath, 'C:\\u\\.ssh\\id_ed25519')
  assert.equal(merged.passphrase, 'pp')
  assert.deepEqual(merged.jump, prev.jump)
  // Explicit empty strings = CLEAR (wire contract: omitted keeps, '' clears).
  merged = mergeTestFields({ privateKeyPath: '', passphrase: '', agent: '' }, prev)
  assert.equal(merged.privateKeyPath, undefined)
  assert.equal(merged.passphrase, undefined)
  assert.equal(merged.agent, undefined)
  // A typed replacement wins.
  merged = mergeTestFields({ privateKeyPath: 'C:\\u\\.ssh\\id_rsa' }, prev)
  assert.equal(merged.privateKeyPath, 'C:\\u\\.ssh\\id_rsa')
  // No prev → nothing merged (a brand-new machine test needs its own input).
  merged = mergeTestFields({ privateKeyPath: '' }, undefined)
  assert.equal(merged.privateKeyPath, undefined)
  // An explicit (even empty) jump replaces the stored chain per save semantics.
  merged = mergeTestFields({ jump: [{ host: 'other' }] }, prev)
  assert.deepEqual(merged.jump, [{ host: 'other' }])
  // t8: `jump: []` = clear — the test must NOT fall back to the stored chain.
  merged = mergeTestFields({ jump: [] }, prev)
  assert.equal(merged.jump, undefined)
  merged = mergeTestFields({}, { ...prev, jump: undefined })
  assert.equal(merged.jump, undefined)
})

test('t8: an explicit empty jump chain CLEARS a stored ProxyJump on update', async () => {
  const { registry, machinesFile } = newRegistry()
  const created = await registry.saveMachine({
    host: 'j1', username: 'u',
    jump: [{ host: 'bastion', port: 2202, username: 'jump' }],
  })
  assert.equal(created.jumpHosts.length, 1)
  // The edit cleared the jump text → `jump: []` → the stored chain is gone.
  const cleared = await registry.saveMachine({ id: created.id, host: 'j1', username: 'u', jump: [] })
  assert.equal(cleared.jumpHosts.length, 0)
  await sleep(20)
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.deepEqual(list[0]?.jump, [])
  // A NEW machine omitting the chain has no jump at all (unchanged behavior).
  const fresh = await registry.saveMachine({ host: 'j2', username: 'u' })
  assert.equal(fresh.jumpHosts.length, 0)
  assert.equal(registry.status().machines.find(machine => machine.id === fresh.id)?.jumpHosts.length, 0)
})

test('P2-④: an explicit empty privateKeyPath CLEARS the stored key on update', async () => {
  const { registry, machinesFile } = newRegistry()
  const created = await registry.saveMachine({ host: 'k3', username: 'u', privateKeyPath: 'C:\\u\\.ssh\\id_ed25519' })
  assert.equal(created.auth, 'key')
  // The wire contract: '' (not undefined) is the explicit "no key" signal.
  const cleared = await registry.saveMachine({ id: created.id, host: 'k3', username: 'u', privateKeyPath: '' })
  assert.equal((cleared as unknown as Record<string, unknown>).privateKeyPath, undefined)
  await sleep(20)
  const list = persisted(machinesFile).list as Array<Record<string, unknown>>
  assert.equal('privateKeyPath' in (list[0] as object), false)
})
