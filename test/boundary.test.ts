/**
 * R1 boundary regression tests:
 * 1) `browse.home` no longer swallows connect/auth failures into a fake
 *    `ok: true {path:'/root'}` — only an unreadable environment on an ALIVE
 *    connection (or an unset HOME) falls back to the configured cwd.
 * 2) The settings payload opts a keychain machine explicitly back into
 *    plaintext when the keychain toggle is unchecked AND a new password is
 *    typed (5.11-b); unchecked with no password never switches backends.
 * 3) Transited error messages redact credential values (private-key paths,
 *    passwords, passphrases) to `<redacted>`.
 * 4) `registry.test()` resolves a keychain machine's OS-store password so a
 *    test no longer misreports failure on an empty password.
 * 5) Machine-id allocation never reuses a caller-supplied `cN` id.
 * 6) The picker's remote-home resolve is lazy (W1: mount-time eagerness
 *    killed the bundle on a placeholder row), and `registry.test()` treats
 *    empty-string identity fields as unconfigured (no ENOENT pre-auth).
 * @module test/boundary
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { test } from 'node:test'
import type { Client } from 'ssh2'
import { Context } from '@deepseek-ai/cordis'
import { remoteHome } from '../src/listing.ts'
import { SshDirectoryPicker } from '../src/picker.ts'
import { parseSshTargetKey, sshRoutesRoot } from '../src/transport.ts'
import type { SshTransport } from '../src/transport.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import { resolvePrivateKey } from '../src/ssh-core.ts'
import { redactSpecMessage, redactValues, SshConnection } from '../src/connection.ts'
import type { SshConnectionSpec } from '../src/connection.ts'
import { resolveTestPassword, SshRegistry } from '../src/registry.ts'
import { EMPTY_MACHINE_FORM, machinePayload } from '../src/client/machine-payload.ts'
import type { MachineFormState } from '../src/client/machine-payload.ts'

/* ---------------------------------------------------------------- helpers */

/** A transport stub answering only the faces a test exercises. */
function fakeTransport(overrides: Partial<SshTransport> = {}): SshTransport {
  const transport: SshTransport = {
    endpoint: 'u@h',
    cwd: '/root',
    getClient: async (): Promise<Client> => ({}) as unknown as Client,
    getSftp: async () => ({}) as never,
    getRemoteEnvironment: async (): Promise<Record<string, string>> => ({}),
    exec: async (): Promise<ExecOutcome> => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }),
    resolveRemoteCwd: (cwd?: string): string => cwd ?? '/root',
  }
  return Object.assign(transport, overrides)
}

/** A registry spec with the required surface only. */
function spec(overrides: Partial<SshConnectionSpec> = {}): SshConnectionSpec {
  return {
    id: 'c1',
    label: 'lab',
    host: 'h',
    port: 22,
    username: 'u',
    ...overrides,
  }
}

/** A form state with the required surface only. */
function form(overrides: Partial<MachineFormState> = {}): MachineFormState {
  return { ...EMPTY_MACHINE_FORM, host: 'h', ...overrides }
}

function newRegistry(): { registry: SshRegistry; machinesFile: string } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-boundary-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  return { registry, machinesFile }
}

const keychainPrev: SshConnectionSpec = spec({
  id: 'c1',
  credentialBackend: 'windows',
  password: '',
})
const plainPrev: SshConnectionSpec = spec({ id: 'c1', credentialBackend: 'plain', password: 'plain-pw' })

/* ---------------------------------------------------- 1) browse.home errors */

test('browse.home: a connect failure propagates instead of returning a fake home', async () => {
  const transport = fakeTransport({
    getClient: async () => { throw new Error('dsw: cannot connect to "lab" (u@h): ECONNREFUSED') },
  })
  await assert.rejects(
    async () => remoteHome(transport),
    /dsw: cannot connect to "lab" \(u@h\): ECONNREFUSED/u,
  )
})

test('browse.home: HOME from the login environment wins', async () => {
  const transport = fakeTransport({ getRemoteEnvironment: async () => ({ HOME: '/home/u' }) })
  assert.equal(await remoteHome(transport), '/home/u')
})

test('browse.home: an environment without HOME falls back to the configured cwd', async () => {
  const transport = fakeTransport({ getRemoteEnvironment: async () => ({}) })
  assert.equal(await remoteHome(transport), '/root')
})

test('browse.home: an unreadable environment on an ALIVE connection still falls back to cwd', async () => {
  const transport = fakeTransport({
    getRemoteEnvironment: async () => { throw new Error('dsw: cannot read the remote environment') },
  })
  assert.equal(await remoteHome(transport), '/root')
})

test('browse.home: connect failure on the default cwd machine is not masked by a HOME present later', async () => {
  const transport = fakeTransport({
    getClient: async () => { throw new Error('dsw: cannot connect to "lab" (u@h): CLIENT_AUTH failed') },
  })
  // The failing connect must preempt any fallback, even when the caller's list
  // would have surfaced the error later.
  await assert.rejects(async () => remoteHome(transport), /CLIENT_AUTH/u)
})

/* ------------------------------------------- 2) keychain → plaintext switch */

test('payload: unchecking keychain AND typing a new password sends credentialBackend plain', () => {
  const payload = machinePayload(form({ password: 'newpw', encryptPassword: false }))
  assert.equal(payload.credentialBackend, 'plain')
  assert.equal(payload.password, 'newpw')
})

test('payload: unchecked with NO new password never switches backends', () => {
  const payload = machinePayload(form({ password: '', encryptPassword: false }))
  assert.equal('credentialBackend' in payload, false)
  assert.equal('password' in payload, false)
})

test('payload: keychain checked with a password keeps the encrypt flag and no explicit backend', () => {
  const payload = machinePayload(form({ password: 'pw', encryptPassword: true }))
  assert.equal(payload.encryptPassword, true)
  assert.equal('credentialBackend' in payload, false)
})

test('payload: a keychain machine edit with no new password sends no backend switch', () => {
  const payload = machinePayload(form({ id: 'c1', password: '', encryptPassword: true }))
  assert.equal(payload.id, 'c1')
  assert.equal(payload.encryptPassword, true)
  assert.equal('credentialBackend' in payload, false)
})

/* --------------------------------------------------- 3) error redaction */

test('redaction: private-key paths and passwords become <redacted>', () => {
  const target = spec({
    privateKeyPath: 'C:\\Users\\u\\.ssh\\id_ed25519',
    password: 'swordfish',
  })
  const message = `ENOENT: no such file or directory, open 'C:\\Users\\u\\.ssh\\id_ed25519' for machine swordfish`
  assert.equal(
    redactSpecMessage(message, target),
    `ENOENT: no such file or directory, open '<redacted>' for machine <redacted>`,
  )
})

test('redaction: jump-hop credential values are redacted too', () => {
  const target = spec({
    jump: [{ host: 'bastion', privateKey: '/home/u/.ssh/bastion', password: 'jump-secret' }],
  })
  const message = 'cannot read key `/home/u/.ssh/bastion` (jump-secret)'
  const redacted = redactSpecMessage(message, target)
  assert.equal(redacted.includes('/home/u/.ssh/bastion'), false)
  assert.equal(redacted.includes('jump-secret'), false)
  assert.equal(redacted.includes('<redacted>'), true)
})

test('redaction: short password values are not substituted (word-collision guard)', () => {
  const target = spec({ password: 'pw' })
  assert.equal(redactSpecMessage('ENOENT: open pw file', target), 'ENOENT: open pw file')
})

test('redaction: redactValues leaves unrelated text untouched', () => {
  assert.equal(redactValues('all good here', ['oops']), 'all good here')
})

test('redaction: SshConnection construction redacts a missing identity-file path', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-missing-key-'))
  const missing = join(home, 'nope', 'id_rsa')
  const target = spec({ privateKeyPath: missing })
  assert.throws(() => new SshConnection(target), (error: unknown) => {
    const text = String(error)
    return text.includes('id_rsa') === false && text.includes('<redacted>')
  })
})

test('redaction: a missing jump identity path is redacted as well', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-missing-jump-'))
  const missing = join(home, 'nope', 'bastion')
  const target = spec({ jump: [{ host: 'bastion', privateKey: missing }] })
  assert.throws(() => new SshConnection(target), (error: unknown) => {
    const text = String(error)
    return text.includes('nope') === false && text.includes('<redacted>')
  })
})

/* --------------------------------------- 4) registry.test() sees keychain */

test('registry.test: a keychain machine resolves the OS-store password', async () => {
  const resolver = async (target: SshConnectionSpec): Promise<string | undefined> =>
    target.id === 'c1' ? 'keychain-secret' : undefined
  const password = await resolveTestPassword({ host: 'h', username: 'u', id: 'c1' }, keychainPrev, resolver)
  assert.equal(password, 'keychain-secret')
})

test('registry.test: an explicit input password always wins over the keychain', async () => {
  const resolver = async (): Promise<string | undefined> => 'keychain-secret'
  const password = await resolveTestPassword(
    { host: 'h', username: 'u', id: 'c1', password: 'typed' },
    keychainPrev,
    resolver,
  )
  assert.equal(password, 'typed')
})

test('registry.test: a provider miss leaves no password (no empty-password auth attempt)', async () => {
  const resolver = async (): Promise<string | undefined> => undefined
  const password = await resolveTestPassword({ host: 'h', username: 'u', id: 'c1' }, keychainPrev, resolver)
  assert.equal(password, '')
})

test('registry.test: an id-only test of a plaintext machine uses the stored password (F1)', async () => {
  let called = false
  const resolver = async (): Promise<string | undefined> => {
    called = true
    return 'should-not'
  }
  // F1: a plain prev with a stored password must authenticate with it (the
  // form's「测试连接」on an edited plain machine sends id only) — no default
  // identity fallback, no false-positive. The keychain resolver is never
  // consulted for plain machines.
  const password = await resolveTestPassword({ host: 'h', username: 'u', id: 'c1' }, plainPrev, resolver)
  assert.equal(password, 'plain-pw')
  assert.equal(called, false)
})

test('registry.test: a plaintext machine with no stored password stays password-less', async () => {
  const resolver = async (): Promise<string | undefined> => 'should-not'
  const password = await resolveTestPassword(
    { host: 'h', username: 'u', id: 'c1' },
    { id: 'c1', host: 'h', port: 22, username: 'u', credentialBackend: 'plain' },
    resolver,
  )
  assert.equal(password, '')
})

test('registry.test: a typed password wins over a stored plaintext password', async () => {
  const password = await resolveTestPassword(
    { host: 'h', username: 'u', id: 'c1', password: 'typed' },
    plainPrev,
    async () => 'should-not',
  )
  assert.equal(password, 'typed')
})

/* ---------------------------------------------------- 5) nextId allocation */

test('nextId: an unknown caller-supplied cN id is never reused by the allocator', async () => {
  const { registry } = newRegistry()
  await registry.saveMachine({ host: 'h0', username: 'u', id: 'c7' })
  const next = await registry.saveMachine({ host: 'h1', username: 'u' })
  assert.notEqual(next.id, 'c7')
  assert.equal(next.id, 'c8')
  const ids = registry.listMachines().machines.map(machine => machine.id).sort()
  assert.deepEqual(ids, ['c7', 'c8'])
})

test('nextId: add() and saveMachine() share one allocator (c1, c2, c3, c4)', async () => {
  const { registry } = newRegistry()
  const a = await registry.saveMachine({ host: 'a', username: 'u' })
  const b = registry.add({ host: 'b', username: 'u' })
  const c = await registry.saveMachine({ host: 'c', username: 'u', id: 'c3' })
  const d = await registry.saveMachine({ host: 'd', username: 'u' })
  assert.equal(a.id, 'c1')
  assert.equal(b.id, 'c2')
  assert.equal(c.id, 'c3')
  assert.equal(d.id, 'c4')
})

test('nextId: the allocator follows the loaded table, not a stale cache', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-sw-nextid-'))
  const machinesFile = join(home, 'remote-workspaces', 'machines.json')
  mkdirSync(join(home, 'remote-workspaces'), { recursive: true })
  writeFileSync(machinesFile, JSON.stringify({
    currentId: 'c1',
    list: ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => ({
      id, label: id, host: `h-${id}`, port: 22, username: 'u',
    })),
  }, null, 2), 'utf8')
  const registry = new SshRegistry(new Context(), {
    machinesFile,
    stateFile: join(home, 'dsh-ssh-connections.json'),
    knownHostsFile: join(home, 'remote-workspaces', 'known_hosts.json'),
    secretsDir: join(home, 'remote-workspaces', '.secrets'),
  })
  const view = await registry.saveMachine({ host: 'new', username: 'u' })
  assert.equal(view.id, 'c6')
})

/* ------------------------------------------- 6) rename: route placeholders */

test('rename: the placeholder root is dsw-routes', () => {
  assert.equal(sshRoutesRoot().endsWith('dsw-routes'), true)
})

test('rename: new dsw-routes placeholders route to the registry connection', () => {
  const parsed = parseSshTargetKey(`${sshRoutesRoot()}\\c1\\home\\uuz`)
  assert.equal(parsed.connectionId, 'c1')
  assert.equal(parsed.path, '/home/uuz')
})

test('rename: legacy dsh-ssh-routes placeholders keep routing (existing session cwd)', () => {
  const legacy = `${sshRoutesRoot().replace(/[\\/]dsw-routes$/u, `${sep}dsh-ssh-routes`)}\\c1\\home\\uuz`
  const parsed = parseSshTargetKey(legacy)
  assert.ok(parsed !== null)
  assert.equal(parsed.connectionId, 'c1')
  assert.equal(parsed.path, '/home/uuz')
})

/* ------------------------- 7) W1: picker lazy remote home (no mount-time connect) */

/** A picker-shaped transport stub counting chain opens, with an empty remote level. */
function pickerTransport(): { ssh: SshTransport; connectCalls: () => number } {
  const state = { count: 0 }
  const ssh = fakeTransport({
    getClient: async (): Promise<Client> => {
      state.count += 1
      return {} as unknown as Client
    },
    getRemoteEnvironment: async (): Promise<Record<string, string>> => ({ HOME: '/home/u' }),
    getSftp: async () => ({
      readdir: (_path: string, callback: (error: Error | undefined, value: Array<{ filename: string }>) => void) => callback(undefined, []),
    }) as never,
  })
  return { ssh, connectCalls: () => state.count }
}

test('W1: constructing the picker never connects (remote home resolved lazily)', () => {
  const { ssh, connectCalls } = pickerTransport()
  const ctx = new Context()
  ctx.provide('ssh', ssh)
  new SshDirectoryPicker(ctx, { maxEntries: 100 })
  assert.equal(connectCalls(), 0)
})

test('W1: the first remote browse establishes the connection once and caches the home', async () => {
  const { ssh, connectCalls } = pickerTransport()
  const ctx = new Context()
  ctx.provide('ssh', ssh)
  const picker = new SshDirectoryPicker(ctx, { maxEntries: 100 })
  const first = await picker.list('/home/u')
  assert.equal(connectCalls(), 1)
  assert.equal(first.home, '/home/u')
  const second = await picker.list('/home/u')
  assert.equal(connectCalls(), 1) // cached — no second chain open
  assert.equal(second.home, '/home/u')
})

test('W1: a failed lazy resolve is not cached — the next browse retries', async () => {
  let failing = true
  const ssh = fakeTransport({
    getClient: async (): Promise<Client> => {
      if (failing) throw new Error('dsw: cannot connect to "lab" (u@h): ECONNREFUSED')
      return {} as unknown as Client
    },
    getRemoteEnvironment: async (): Promise<Record<string, string>> => ({ HOME: '/home/u' }),
    getSftp: async () => ({
      readdir: (_path: string, callback: (error: Error | undefined, value: Array<{ filename: string }>) => void) => callback(undefined, []),
    }) as never,
  })
  const ctx = new Context()
  ctx.provide('ssh', ssh)
  const picker = new SshDirectoryPicker(ctx, { maxEntries: 100 })
  await assert.rejects(async () => picker.list('/home/u'), /cannot connect/u)
  failing = false
  const listing = await picker.list('/home/u')
  assert.equal(listing.home, '/home/u')
})

/* -------- 8) defect 2: empty-string identity fields are "not configured" -------- */

test('registry.test: an empty privateKeyPath is not configured (no ENOENT before auth)', async () => {
  const { registry } = newRegistry()
  const outcome = await registry.test({ host: '127.0.0.1', port: 1, username: 'u', password: 'x', privateKeyPath: '', passphrase: '', agent: '' })
  assert.equal(outcome.ok, false)
  // The refusal is a connect error, not a missing-key ENOENT (and no credential
  // path leaks into the message).
  assert.match(outcome.message, /ECONNREFUSED|cannot connect/u)
  assert.equal(outcome.message.includes('ENOENT'), false)
})

test('registry.test: a keychain machine tested by id reaches the connect stage (no ENOENT mask)', async () => {
  const { registry } = newRegistry()
  await registry.saveMachine({ host: '127.0.0.1', port: 22, username: 'u', id: 'c1', credentialBackend: 'keychain' })
  const outcome = await registry.test({ host: '127.0.0.1', port: 1, username: 'u', id: 'c1' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.message.includes('ENOENT'), false)
  assert.match(outcome.message, /ECONNREFUSED|cannot connect/u)
})

/* ----------------- 9) observation: keychain→plain purges the stale secret ----------------- */

test('observation: switching a keychain machine to plaintext purges its OS secret', async () => {
  const { registry, machinesFile } = newRegistry()
  const secretsDir = join(dirname(machinesFile), '.secrets')
  mkdirSync(secretsDir, { recursive: true })
  const keychainView = await registry.saveMachine({ host: 'sw', username: 'u', id: 'c1', credentialBackend: 'keychain' })
  assert.equal(keychainView.credentialBackend, 'keychain')
  // Simulate the secret an earlier keychain save left in the store.
  if (process.platform === 'win32') writeFileSync(join(secretsDir, 'c1.bin'), 'stale', 'utf8')
  const plainView = await registry.saveMachine({ host: 'sw', username: 'u', id: 'c1', credentialBackend: 'plain', password: 'newpw' })
  assert.equal(plainView.credentialBackend, 'plain')
  assert.equal(plainView.passwordSet, true)
  if (process.platform === 'win32') {
    assert.equal(existsSync(join(secretsDir, 'c1.bin')), false) // stale secret purged
  }
})

/* ------------- 10) t8: expanded-path & runtime-key redaction ------------- */

test('redaction: a `~`-expanded identity path is cleared from an ENOENT message', () => {
  const marker = `dsh-sw-expanded-${Date.now()}`
  const target = spec({ privateKeyPath: `~/${marker}/id_rsa` })
  assert.throws(() => new SshConnection(target), (error: unknown) => {
    const text = String(error)
    // Node quotes the EXPANDED path in the ENOENT text — both spellings vanish.
    assert.equal(text.includes(marker), false)
    assert.equal(text.includes(`~/${marker}`), false)
    return text.includes('<redacted>')
  })
  // Guard: the marker path is unique enough that absence proves redaction.
  assert.equal(homedir().length > 0, true)
})

test('redaction: resolvePrivateKey clears a missing key path before it propagates', () => {
  const marker = 'dsh-sw-runtime-key'
  assert.throws(() => resolvePrivateKey(join(tmpdir(), marker, 'id_ed25519')), (error: unknown) => {
    const text = String(error)
    // The message is fully sanitized (no path at all) and the error identity
    // (code/name) is preserved.
    return text.includes('dsw: cannot read private key: <redacted>') && text.includes(marker) === false
  })
})
