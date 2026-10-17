/**
 * Passive reachability probes must not persist host keys (UX-13).
 * A stored key is still checked. An unknown key is accepted only in memory.
 * An explicit connect keeps accept-new and writes the store.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SshConnection } from '../src/connection.ts'
import { HostKeyGuard, HostKeyStore, keyFingerprint, makeKeyBlob } from '../src/hostkey.ts'

function storeFile(): { home: string; file: string; store: HostKeyStore } {
  const home = mkdtempSync(join(tmpdir(), 'dsw-hostkey-'))
  const file = join(home, 'known_hosts.json')
  return { home, file, store: new HostKeyStore(file) }
}

function probeConnection(store: HostKeyStore, host = '10.0.0.8'): SshConnection {
  return new SshConnection(
    { id: 'probe', label: 'c1', host, port: 22, username: 'dev' },
    { hostKeyStore: store, persistHostKeys: false },
  )
}

test('UX-13: a probe of an unknown host accepts the key and does not write the store', () => {
  const { file, store } = storeFile()
  const connection = probeConnection(store)
  const key = makeKeyBlob('ssh-ed25519', 4)
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, key), true)
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, key), true)
  // A jump hop the store has never seen is also kept in memory only.
  assert.equal(connection.verifyHostKey('jump.example', 22, makeKeyBlob('ssh-ed25519', 6)), true)
  assert.equal(existsSync(file), false)
  assert.equal(store.get('10.0.0.8', 22), undefined)
  assert.equal(connection.hostKeyKnown('10.0.0.8', 22), false)
  // A different key in the same probe is a mismatch and still writes nothing.
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, makeKeyBlob('ssh-ed25519', 9)), false)
  assert.equal(existsSync(file), false)
})

test('UX-13: a probe rejects a stored host key that does not match, and leaves the file unchanged', () => {
  const { file, store } = storeFile()
  const trusted = makeKeyBlob('ssh-ed25519', 3)
  store.save({
    '10.0.0.8:22': {
      algo: 'ssh-ed25519',
      fingerprint: keyFingerprint(trusted),
      firstSeen: '2026-01-01T00:00:00.000Z',
    },
  })
  const before = readFileSync(file, 'utf8')
  const connection = probeConnection(store)
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, trusted), true)
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, makeKeyBlob('ssh-ed25519', 8)), false)
  assert.equal(readFileSync(file, 'utf8'), before)
  const guard = new HostKeyGuard(store, 'accept-new', false)
  assert.equal(guard.verifier('10.0.0.8', 22)(makeKeyBlob('ssh-ed25519', 8)), false)
  assert.equal(guard.lastFailure, 'changed')
})

test('UX-13: an explicit connect still records an unknown host key', () => {
  const { file, store } = storeFile()
  const connection = new SshConnection(
    { id: 'c1', label: 'c1', host: '10.0.0.8', port: 22, username: 'dev' },
    { hostKeyStore: store },
  )
  const key = makeKeyBlob('ssh-ed25519', 5)
  assert.equal(connection.verifyHostKey('10.0.0.8', 22, key), true)
  assert.equal(existsSync(file), true)
  assert.equal(store.get('10.0.0.8', 22)?.fingerprint, keyFingerprint(key))
})

test('UX-13: verify mode still rejects an unknown key during a probe and does not write', () => {
  const { file, store } = storeFile()
  const guard = new HostKeyGuard(store, 'verify', false)
  assert.equal(guard.verifier('10.0.0.8', 22)(makeKeyBlob('ssh-ed25519', 2)), false)
  assert.equal(guard.lastFailure, 'unknown')
  assert.equal(existsSync(file), false)
})
