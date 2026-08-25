/**
 * R5-T1 单测：副工作区状态层 —— 根键规范化、前缀匹配（最长/边界/家族）、
 * 持久化 CRUD 幂等、损坏文件降级、权限字段默认与更新。
 * @module test/session-workspaces
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import {
  SessionSideWorkspaceStore,
  basenameLabel,
  loadSideWorkspaces,
  normalizeSideRootKey,
  normalizeSideWorkspaceRecord,
  sideRootKeyOf,
  sideWorkspaceOf,
} from '../src/session-workspaces.ts'
import type { SideWorkspaceItem } from '../src/session-workspaces.ts'
import { sshRoutesRoot } from '../src/transport.ts'

/* ---------------------------------------------------- 1) 根键规范化 */

test('normalizeSideRootKey: local requires an absolute path; resolves lexically', () => {
  assert.equal(normalizeSideRootKey('local', ''), null)
  assert.equal(normalizeSideRootKey('local', '   '), null)
  assert.equal(normalizeSideRootKey('local', 'relative/path'), null)
  assert.equal(normalizeSideRootKey('local', resolve(tmpdir(), 'side')), resolve(tmpdir(), 'side'))
  assert.equal(normalizeSideRootKey('local', `${resolve(tmpdir(), 'side')}${sep()}..${sep()}side`), resolve(tmpdir(), 'side'))
})

test('normalizeSideRootKey: remote requires the ssh://<id>/<abs> spelling; posix-normalizes', () => {
  assert.equal(normalizeSideRootKey('remote', '/home/uuz'), null) // no ssh:// spelling
  assert.equal(normalizeSideRootKey('remote', 'ssh://c1'), null) // missing path
  assert.equal(normalizeSideRootKey('remote', 'ssh://c1:22/srv'), null) // port in the id slot
  assert.equal(normalizeSideRootKey('remote', 'ssh://c1//a//b/'), 'ssh://c1/a/b')
  assert.equal(normalizeSideRootKey('remote', 'ssh://c1/'), 'ssh://c1/')
  assert.equal(normalizeSideRootKey('remote', 'ssh://c2/a/b'), 'ssh://c2/a/b')
  assert.equal(normalizeSideRootKey('remote', 'ssh://bad id/a'), null) // id charset
})

test('sideRootKeyOf: round-trips both families; rejects malformed keys', () => {
  const local = normalizeSideRootKey('local', join(tmpdir(), 'sw'))
  assert.deepEqual(sideRootKeyOf(local!), { kind: 'local', path: local })
  assert.deepEqual(sideRootKeyOf('ssh://c1/a/b'), { kind: 'remote', path: '/a/b' })
  assert.equal(sideRootKeyOf('ssh://nope'), null)
  assert.equal(sideRootKeyOf('relative'), null)
})

/* ------------------------------------------------- 2) 前缀匹配（最长/边界） */

function item(over: Partial<SideWorkspaceItem>): SideWorkspaceItem {
  return { id: 'sw-1', kind: 'local', rootKey: '', label: 'x', fs: 'rw', exec: 'on', ...over }
}

test('sideWorkspaceOf: local roots match equal and descendants, never siblings', () => {
  const root = resolve(tmpdir(), 'sw', 'proj')
  const roots = new Map<string, SideWorkspaceItem>([[root, item({ rootKey: root })]])
  assert.equal(sideWorkspaceOf(roots, root)?.rootKey, root)
  assert.equal(sideWorkspaceOf(roots, join(root, 'deep', 'file.txt'))?.rootKey, root)
  assert.equal(sideWorkspaceOf(roots, join(root, 'sub', '..', 'file.txt'))?.rootKey, root) // resolve() re-canonicalizes
  assert.equal(sideWorkspaceOf(roots, join(root, '..', 'proj2', 'f')), undefined) // sibling stays outside
  assert.equal(sideWorkspaceOf(roots, `${root}x`), undefined) // separator boundary
  assert.equal(sideWorkspaceOf(roots, resolve(tmpdir(), 'other')), undefined)
  assert.equal(sideWorkspaceOf(roots, 'relative/path'), undefined)
})

test('sideWorkspaceOf: remote roots match by machine + POSIX prefix, never a different machine', () => {
  const roots = new Map<string, SideWorkspaceItem>([
    ['ssh://c1/a/b', item({ rootKey: 'ssh://c1/a/b', kind: 'remote' })],
  ])
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1/a/b')?.rootKey, 'ssh://c1/a/b')
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1/a/b/c/d')?.rootKey, 'ssh://c1/a/b')
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1//a//b/')?.rootKey, 'ssh://c1/a/b') // degenerate spelling canonicalizes onto the root
  assert.equal(sideWorkspaceOf(roots, 'ssh://c2/a/b'), undefined) // different machine
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1/a/bc'), undefined) // separator boundary
  assert.equal(sideWorkspaceOf(roots, resolve(tmpdir(), 'x')), undefined) // family mismatch
})

test('sideWorkspaceOf: the LONGEST matching root wins (nested roots)', () => {
  const outer = resolve(tmpdir(), 'sw', 'outer')
  const inner = join(outer, 'inner')
  const roots = new Map<string, SideWorkspaceItem>([
    [outer, item({ id: 'sw-out', rootKey: outer })],
    [inner, item({ id: 'sw-in', rootKey: inner })],
  ])
  assert.equal(sideWorkspaceOf(roots, join(inner, 'file'))?.id, 'sw-in')
  assert.equal(sideWorkspaceOf(roots, join(outer, 'deep', 'file'))?.id, 'sw-out')
  // Insertion order independence: inner declared first still wins.
  const roots2 = new Map<string, SideWorkspaceItem>([
    [inner, item({ id: 'sw-in', rootKey: inner })],
    [outer, item({ id: 'sw-out', rootKey: outer })],
  ])
  assert.equal(sideWorkspaceOf(roots2, join(inner, 'file'))?.id, 'sw-in')
})

/* --------------------------------------------- 3) 持久化与 CRUD 幂等 */

test('loadSideWorkspaces: missing file reads empty; corrupt file warns and reads empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const missing = join(dir, 'missing.json')
  let warned = ''
  const state = loadSideWorkspaces(missing, message => { warned = message })
  assert.equal(state.roots.size, 0)
  assert.equal(state.sessions.size, 0)
  assert.equal(warned, '')

  const corrupt = join(dir, 'corrupt.json')
  writeFileSync(corrupt, '{ not json', 'utf8')
  const state2 = loadSideWorkspaces(corrupt, message => { warned = message })
  assert.equal(state2.roots.size, 0)
  assert.ok(warned.includes('cannot read side-workspace state'))
})

test('normalizeSideWorkspaceRecord: valid records pass; bad kinds/defaults resolve honestly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const local = resolve(dir, 'proj')
  assert.deepEqual(normalizeSideWorkspaceRecord({ id: 'a', kind: 'local', rootKey: local, label: '  P  ', fs: 'r', exec: 'off' as const }), {
    id: 'a', kind: 'local', rootKey: local, label: 'P', fs: 'r', exec: 'off',
  })
  const def = normalizeSideWorkspaceRecord({ id: 'b', kind: 'local', rootKey: local })!
  assert.equal(def.label, basenameLabel('local', local))
  assert.equal(def.fs, 'rw')
  assert.equal(def.exec, 'on')
  assert.equal(normalizeSideWorkspaceRecord({ id: 'c', kind: 'remote', rootKey: local }), null) // kind/key mismatch
  assert.equal(normalizeSideWorkspaceRecord({ kind: 'local', rootKey: local }), null) // missing id
})

test('SessionSideWorkspaceStore: attach/list/detach/update/persist roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const file = join(dir, 'state.json')
  const ctx = new Context()
  const store = new SessionSideWorkspaceStore(ctx, { file })
  const local = resolve(dir, 'proj')
  const remote = 'ssh://c1/srv/work'

  const first = store.attach('session-1', { id: 'sw-a', kind: 'local', path: local, label: 'P' })
  assert.equal(first.rootKey, local)
  assert.equal(first.fs, 'rw')
  assert.equal(first.exec, 'on')
  const second = store.attach('session-1', { id: 'sw-b', kind: 'remote', path: remote, fs: 'r' })
  assert.equal(second.kind, 'remote')
  assert.deepEqual(store.listFor('session-1').map(entry => entry.id), ['sw-a', 'sw-b'])

  // Same rootKey: idempotent attach moves it to the END and applies the patch.
  const updated = store.attach('session-1', { id: 'sw-a', kind: 'local', path: local, fs: 'r' })
  assert.equal(updated.fs, 'r')
  assert.equal(updated.label, 'P') // omitted label keeps the stored one
  assert.deepEqual(store.listFor('session-1').map(entry => entry.id), ['sw-b', 'sw-a'])

  // match() sees the canonical records.
  assert.equal(store.match(join(local, 'file.txt'))?.id, 'sw-a')
  assert.equal(store.match('ssh://c1/srv/work/deep')?.id, 'sw-b')
  assert.equal(store.match('ssh://c1/other'), undefined)

  // update() patches permissions; detach() removes the account and drops the
  // orphaned root record.
  assert.equal(store.update(local, { fs: 'rw', exec: 'off', label: 'P2' }), true)
  assert.equal(store.match(local)?.fs, 'rw')
  assert.equal(store.match(local)?.exec, 'off')
  assert.equal(store.update(local, { fs: 'r' }), true)
  assert.equal(store.match(local)?.fs, 'r')
  assert.equal(store.detach('session-1', local), true)
  assert.equal(store.match(local), undefined) // last ref dropped → root gone
  assert.equal(store.match('ssh://c1/srv/work')?.id, 'sw-b') // still referenced → kept

  // Persistence: a fresh store on the same file sees the surviving state.
  const revived = new SessionSideWorkspaceStore(new Context(), { file })
  assert.deepEqual(revived.listFor('session-1').map(entry => entry.id), ['sw-b'])
  assert.equal(revived.match('ssh://c1/srv/work/deep')?.fs, 'r')
  const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, string[]> }
  assert.deepEqual(onDisk.sessions['session-1'], ['ssh://c1/srv/work'])
})

test('SessionSideWorkspaceStore: invalid attach rejects with a dsw: error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const store = new SessionSideWorkspaceStore(new Context(), { file: join(dir, 's.json') })
  assert.throws(() => store.attach('s1', { id: 'x', kind: 'local', path: 'relative' }), /absolute local path/)
  assert.throws(() => store.attach('s1', { id: 'x', kind: 'remote', path: '/home/uuz' }), /ssh:\/\/<id>/)
  assert.throws(() => store.attach('', { id: 'x', kind: 'local', path: resolve(dir, 'p') }), /session id/)
})

function sep(): string {
  return resolve(tmpdir(), 'a').includes('\\') ? '\\' : '/'
}

/* --------------------------------------- 5) 匹配器：t2 评审修复回归用例 */

test('t2-fix: the LOCAL PLACEHOLDER spelling of a remote dir matches the remote root', () => {
  const root = 'ssh://c1/srv/work'
  const roots = new Map<string, SideWorkspaceItem>([[root, item({ rootKey: root, kind: 'remote' })]])
  // A remote session's spawn cwd is the placeholder: <dshHome>/dsw-routes/c1/srv/work
  assert.equal(sideWorkspaceOf(roots, join(sshRoutesRoot(), 'c1', 'srv', 'work'))?.rootKey, root)
  assert.equal(sideWorkspaceOf(roots, join(sshRoutesRoot(), 'c1', 'srv', 'work', 'run.sh'))?.rootKey, root)
  // The legacy tree routes too.
  assert.equal(sideWorkspaceOf(roots, join(sshRoutesRoot(), 'c1', 'srv', 'work').replace('dsw-routes', 'dsh-ssh-routes'))?.rootKey, root)
  // A different machine's placeholder never matches.
  assert.equal(sideWorkspaceOf(roots, join(sshRoutesRoot(), 'c2', 'srv', 'work')), undefined)
})

test('t2-fix: separator-ending root keys (ssh://c1/ and the drive root) match their children', () => {
  const roots = new Map<string, SideWorkspaceItem>([
    ['ssh://c1/', item({ rootKey: 'ssh://c1/', kind: 'remote' })],
  ])
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1/something/deep')?.rootKey, 'ssh://c1/')
  assert.equal(sideWorkspaceOf(roots, 'ssh://c1/')?.rootKey, 'ssh://c1/')
  assert.equal(sideWorkspaceOf(roots, '/something/deep')?.rootKey, 'ssh://c1/') // win32 bare POSIX spelling
  if (process.platform === 'win32') {
    assert.equal(normalizeSideRootKey('local', 'C:\\'), 'C:\\')
    const drive = new Map<string, SideWorkspaceItem>([['C:\\', item({ rootKey: 'C:\\' })]])
    assert.equal(sideWorkspaceOf(drive, 'C:/Users/x/y')?.rootKey, 'C:\\')
    assert.equal(sideWorkspaceOf(drive, 'D:/other'), undefined) // different drive
  }
})

test('t2-fix: win32 local matching is case-insensitive; POSIX remote stays case-sensitive', () => {
  if (process.platform !== 'win32') return
  const root = resolve(tmpdir(), 'CaseProj')
  const roots = new Map<string, SideWorkspaceItem>([[root, item({ rootKey: root })]])
  assert.equal(sideWorkspaceOf(roots, join(resolve(tmpdir(), 'CASEPROJ'), 'file.txt'))?.rootKey, root)
  const remote = new Map<string, SideWorkspaceItem>([['ssh://c1/A', item({ rootKey: 'ssh://c1/A', kind: 'remote' })]])
  assert.equal(sideWorkspaceOf(remote, 'ssh://c1/a'), undefined) // POSIX paths are case-sensitive
  assert.equal(sideWorkspaceOf(remote, 'ssh://c1/A')?.rootKey, 'ssh://c1/A')
})

test('t2-fix: normalizeSideWorkspaceRecord re-canonicalizes degenerate root keys', () => {
  const remote = normalizeSideWorkspaceRecord({ id: 'r', kind: 'remote', rootKey: 'ssh://c1//a//b/' })!
  assert.equal(remote.rootKey, 'ssh://c1/a/b')
  const local = normalizeSideWorkspaceRecord({ id: 'l', kind: 'local', rootKey: join(resolve(tmpdir(), 'sw'), 'x', '..', 'proj') })!
  assert.equal(local.rootKey, resolve(tmpdir(), 'sw', 'proj'))
})

test('t2-fix: detach prunes the empty session account from the persisted state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const file = join(dir, 'state.json')
  const store = new SessionSideWorkspaceStore(new Context(), { file })
  const local = resolve(dir, 'proj')
  store.attach('s1', { id: 'sw-a', kind: 'local', path: local })
  assert.equal(store.detach('s1', local), true)
  const revived = new SessionSideWorkspaceStore(new Context(), { file })
  assert.deepEqual(revived.listFor('s1'), [])
  const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { sessions: Record<string, unknown> }
  assert.deepEqual(Object.keys(onDisk.sessions), []) // no dangling "s1": [] key
})

test('t2-fix: loadSideWorkspaces re-canonicalizes references and drops emptied accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const file = join(dir, 'state.json')
  const degenerate = 'ssh://c1//srv//work/'
  writeFileSync(file, JSON.stringify({
    roots: {
      [degenerate]: { id: 'sw-a', kind: 'remote', rootKey: degenerate, label: 'work', fs: 'r', exec: 'off' },
    },
    sessions: {
      s1: [degenerate, 'ssh://c1//srv//work/'],
      gone: [],
      '  padded  ': ['ssh://c1//srv//work/'],
    },
  }), 'utf8')
  const state = loadSideWorkspaces(file, () => {})
  assert.deepEqual([...state.roots.keys()], ['ssh://c1/srv/work'])
  assert.deepEqual(state.sessions.get('s1'), ['ssh://c1/srv/work'])
  assert.equal(state.sessions.has('gone'), false)
  assert.deepEqual(state.sessions.get('padded'), ['ssh://c1/srv/work'])
})

test('t2-fix: attach/listFor/detach treat padded session ids consistently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  const store = new SessionSideWorkspaceStore(new Context(), { file: join(dir, 's.json') })
  const local = resolve(dir, 'proj')
  store.attach('  sess-1  ', { id: 'sw-a', kind: 'local', path: local })
  store.attach('  sess-1  ', { id: 'sw-b', kind: 'remote', path: 'ssh://c1/x', fs: 'r' })
  assert.deepEqual(store.listFor('sess-1').map(entry => entry.id), ['sw-a', 'sw-b'])
  assert.deepEqual(store.listFor('  sess-1  ').map(entry => entry.id), ['sw-a', 'sw-b'])
  assert.equal(store.detach('sess-1', local), true)
  assert.equal(store.detach('  sess-1  ', 'ssh://c1/x'), true)
  assert.deepEqual(store.listFor('sess-1'), [])
})

test('t2-fix: a failing persist warns instead of throwing (in-memory stays authoritative)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-sw-'))
  // The state "file" IS a directory: read and write both fail, never throw.
  const store = new SessionSideWorkspaceStore(new Context(), { file: dir })
  assert.doesNotThrow(() => store.attach('s1', { id: 'sw-a', kind: 'local', path: resolve(dir, 'proj') }))
  assert.equal(store.listFor('s1').length, 1)
})
