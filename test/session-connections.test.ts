/**
 * REQ-I11: the per-session connected-machine store. These cases pin the
 * persistence contract (one file, machine-id references only), the mutation
 * semantics the tool layer and the panel share, and the "stale id" pruning that
 * keeps a deleted machine from staying connected.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  SessionMachineConnections,
  defaultSessionConnectionsFile,
  loadSessionConnections,
  normalizeMachineId,
  normalizeMachineIds,
  sessionConnectionsFilePath,
} from '../src/session-connections.ts'

const tempFile = (): { dir: string; file: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-conn-'))
  return { dir, file: join(dir, 'connections.json') }
}

test('normalizeMachineId: trims, accepts the routing charset, rejects route-breaking spellings', () => {
  assert.equal(normalizeMachineId('  c1 '), 'c1')
  assert.equal(normalizeMachineId('tmp-a.2_x'), 'tmp-a.2_x')
  assert.equal(normalizeMachineId(''), null)
  assert.equal(normalizeMachineId('   '), null)
  assert.equal(normalizeMachineId('c1/../../etc'), null)
  assert.equal(normalizeMachineId('c1:22'), null)
  assert.equal(normalizeMachineId('a b'), null)
  assert.equal(normalizeMachineId('.git'), null)
  assert.equal(normalizeMachineId(7), null)
  assert.equal(normalizeMachineId(undefined), null)
})

test('normalizeMachineIds: first-seen order, dedupe, junk dropped', () => {
  assert.deepEqual(normalizeMachineIds(['c2', 'c1', 'c2', '', 'bad/id', 5, ' c3 ']), ['c2', 'c1', 'c3'])
})

test('sessionConnectionsFilePath: lives in the DSH home by default', () => {
  assert.equal(defaultSessionConnectionsFile('/home/x'), join('/home/x', 'dsw-session-connections.json'))
  assert.equal(sessionConnectionsFilePath('/home/x'), defaultSessionConnectionsFile('/home/x'))
})

test('loadSessionConnections: missing file reads empty', () => {
  const { file } = tempFile()
  assert.equal(loadSessionConnections(file, () => {}).size, 0)
})

test('loadSessionConnections: corrupt file warns and reads empty', () => {
  const { file } = tempFile()
  writeFileSync(file, '{ not json')
  const warnings: string[] = []
  assert.equal(loadSessionConnections(file, message => warnings.push(message)).size, 0)
  assert.equal(warnings.length, 1)
})

test('loadSessionConnections: junk entries dropped, empty accounts pruned, unknown fields ignored', () => {
  const { file } = tempFile()
  writeFileSync(file, JSON.stringify({
    sessions: {
      s1: ['c1', ' c1 ', '', 'bad/id', 9, 'c2'],
      ' s2 ': ['c3'],
      s3: [],
      s4: 'not-an-array',
    },
    roots: { legacy: 'ignored' },
  }))
  const loaded = loadSessionConnections(file, () => {})
  assert.deepEqual([...loaded.keys()], ['s1', 's2'])
  assert.deepEqual(loaded.get('s1'), ['c1', 'c2'])
  assert.deepEqual(loaded.get('s2'), ['c3'])
})

test('SessionMachineConnections: connect is idempotent, ordered, and per-session', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  assert.deepEqual(store.connect('s1', 'c2'), ['c2'])
  assert.deepEqual(store.connect('s1', 'c1'), ['c2', 'c1'])
  assert.deepEqual(store.connect('s1', 'c2'), ['c2', 'c1'], 're-connecting keeps the original position')
  assert.deepEqual(store.connect('s2', 'c9'), ['c9'])
  assert.deepEqual(store.listFor('s1'), ['c2', 'c1'])
  assert.deepEqual(store.listFor('s2'), ['c9'])
  assert.deepEqual(store.listFor('unknown'), [])
  assert.equal(store.has('s1', 'c1'), true)
  assert.equal(store.has('s1', 'c9'), false)
  assert.deepEqual(store.sessionIds().sort(), ['s1', 's2'])
})

test('SessionMachineConnections: set() replaces the whole set and clears on empty', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  store.connect('s1', 'c1')
  assert.deepEqual(store.set('s1', ['c3', 'c2', 'c3', 'bad/id']), ['c3', 'c2'])
  assert.deepEqual(store.listFor('s1'), ['c3', 'c2'], 'set is a replacement, not a union')
  assert.deepEqual(store.set('s1', []), [])
  assert.deepEqual(store.listFor('s1'), [])
  assert.deepEqual(store.sessionIds(), [], 'an emptied account leaves no key behind')
})

test('SessionMachineConnections: padded session ids collapse onto one account', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  store.connect(' s1 ', 'c1')
  assert.deepEqual(store.listFor('s1'), ['c1'])
  assert.equal(store.disconnect('s1', 'c1'), true)
  assert.deepEqual(store.listFor(' s1 '), [])
})

test('SessionMachineConnections: disconnect is idempotent and reports the first removal', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  store.connect('s1', 'c1')
  store.connect('s1', 'c2')
  assert.equal(store.disconnect('s1', 'c1'), true)
  assert.equal(store.disconnect('s1', 'c1'), false)
  assert.equal(store.disconnect('nope', 'c1'), false)
  assert.equal(store.disconnect('s1', 'bad/id'), false)
  assert.deepEqual(store.listFor('s1'), ['c2'])
  assert.equal(store.clear('s1'), true)
  assert.equal(store.clear('s1'), false)
})

test('SessionMachineConnections: state survives a restart through the one file', () => {
  const { file } = tempFile()
  const first = new SessionMachineConnections(new Context(), { file })
  first.connect('s1', 'c1')
  first.connect('s1', 'c2')
  first.connect('s2', 'c9')

  const revived = new SessionMachineConnections(new Context(), { file })
  assert.deepEqual(revived.listFor('s1'), ['c1', 'c2'])
  assert.deepEqual(revived.listFor('s2'), ['c9'])
  const persisted = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, string[]> }
  assert.deepEqual(Object.keys(persisted.sessions).sort(), ['s1', 's2'])
  assert.equal(revived.statePath, file)
})

test('SessionMachineConnections: retain() drops ids the registry no longer knows', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  store.connect('s1', 'c1')
  store.connect('s1', 'gone')
  store.connect('s2', 'gone')

  assert.equal(store.retain(new Set(['c1'])), 2)
  assert.deepEqual(store.listFor('s1'), ['c1'])
  assert.deepEqual(store.sessionIds(), ['s1'], 'a session whose every machine vanished disappears')
  assert.equal(store.retain(new Set(['c1'])), 0, 'a second pass removes nothing')
})

test('SessionMachineConnections: invalid mutations reject with a dsw: error', () => {
  const { file } = tempFile()
  const store = new SessionMachineConnections(new Context(), { file })
  assert.throws(() => store.connect('', 'c1'), /dsw: a session connection needs a non-empty session id/)
  assert.throws(() => store.connect('s1', ''), /dsw: a session connection needs a valid machine id/)
  assert.throws(() => store.set('  ', ['c1']), /dsw: a session connection needs a non-empty session id/)
})

test('SessionMachineConnections: a failing persist warns and keeps the in-memory state', () => {
  const { dir, file } = tempFile()
  // Point the state file AT a directory: every write is EISDIR/EPERM.
  writeFileSync(join(dir, 'decoy'), 'x')
  const store = new SessionMachineConnections(new Context(), { file: dir })
  store.connect('s1', 'c1')
  assert.deepEqual(store.listFor('s1'), ['c1'])
  assert.equal(file.endsWith('connections.json'), true)
})
