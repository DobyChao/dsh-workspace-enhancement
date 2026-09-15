/**
 * Session workspace cockpit tests (REQ-I11 client half).
 *
 * The panel's judgments are pure and live in `src/client/cockpit.ts` (the
 * sandbox runner never executes `.tsx`), so these cases pin exactly the
 * properties ADR-0021 §2.9 promises:
 *
 *  1. section derivation — a local session has no main workspace, a routed cwd
 *     has one (every accepted spelling), and `machines.list` is the only source
 *     of connection rows;
 *  2. the IMPLICIT main machine — a routed machine counts as connected with an
 *     empty store (the host's `sw_exec` union) and has no toggle, because its
 *     connection comes from the cwd and could not be removed;
 *  3. stale ids — a connected id the registry no longer knows renders no row and
 *     no toggle, and a store holding only stale ids shows the empty state;
 *  4. the toggle derivation — endpoint + payload per row, undefined where a
 *     toggle must not happen;
 *  5. wire parsing — junk from `machines.list` / `session.ws.list` /
 *     `session.conn.list` degrades to fewer rows, never to a crash.
 *
 * A source guard closes the two regressions a reviewer cannot see in a
 * screenshot: the panel must derive through `./cockpit.ts` and must READ the
 * connected set from `session.conn.list` (never keep a local copy as truth).
 *
 * @module test/client-cockpit
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  asConnectedIds,
  asMachine,
  asMachineRows,
  asSideRows,
  cockpitViewOf,
  machineEndpointOf,
  normalizeIds,
  routeOfCwd,
  staleConnectionIdsOf,
  toggleRequest,
} from '../src/client/cockpit.ts'
import type { CockpitMachine, ConnectionRow } from '../src/client/cockpit.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))

/** The registry universe every case derives against. */
const MACHINES: CockpitMachine[] = [
  { id: 'c1', label: 'Alpha', host: 'alpha.example', username: 'dev' },
  { id: 'c2', label: 'Beta', host: 'beta.example', username: 'ops' },
]

/** The placeholder stroke the host's `session.route` hands back on win32. */
const PLACEHOLDER_CWD = 'C:\\Users\\dev\\.dsh\\dsw-routes\\c2\\srv\\app'

/** The row for one id, failing the test when it is missing. */
function rowOf(rows: readonly ConnectionRow[], id: string): ConnectionRow {
  const row = rows.find(entry => entry.id === id)
  assert.ok(row !== undefined, `no connection row for ${id}`)
  return row
}

test('a local session with no machines has no main workspace and no rows', () => {
  const view = cockpitViewOf(undefined, [], [])

  assert.deepEqual(view.main, { kind: 'none' })
  assert.deepEqual(view.connections, [])
  assert.deepEqual(view.staleConnectionIds, [])
  assert.equal(view.mainMachineId, undefined)
  assert.equal(view.anyConnected, false)
})

test('a local session derives one all-off row per registry machine', () => {
  const view = cockpitViewOf('C:\\Users\\dev\\project', MACHINES, [])

  assert.deepEqual(view.main, { kind: 'none' })
  assert.deepEqual(
    view.connections.map(row => [row.id, row.connected, row.implicit, row.canToggle]),
    [['c1', false, false, true], ['c2', false, false, true]],
  )
  assert.equal(view.anyConnected, false)
})

test('every accepted remote spelling becomes the main workspace (machine + path)', () => {
  assert.deepEqual(routeOfCwd('ssh://c1/srv/app'), { id: 'c1', path: '/srv/app' })
  assert.deepEqual(routeOfCwd(PLACEHOLDER_CWD), { id: 'c2', path: '/srv/app' })
  assert.deepEqual(routeOfCwd('/home/dev/.dsh/dsw-routes/c2/srv'), { id: 'c2', path: '/srv' })
  // The pre-rename tree still routes for live sessions.
  assert.deepEqual(routeOfCwd('C:\\Users\\dev\\.dsh\\dsh-ssh-routes\\c1\\'), { id: 'c1', path: '/' })
  // A route with no path names the machine and the remote root.
  assert.deepEqual(routeOfCwd('ssh://c1'), { id: 'c1', path: '/' })
  // Anything else is a local session — never a guess.
  assert.equal(routeOfCwd('/srv/local'), undefined)
  assert.equal(routeOfCwd('ssh://bad id/x'), undefined)
  assert.equal(routeOfCwd('ssh://.git/HEAD'), undefined)
  assert.equal(routeOfCwd(''), undefined)
  assert.equal(routeOfCwd(undefined), undefined)
})

test('a remote session shows the main machine as connected while the store is empty', () => {
  const view = cockpitViewOf(PLACEHOLDER_CWD, MACHINES, [])

  assert.deepEqual(view.main, {
    kind: 'remote',
    machineId: 'c2',
    label: 'Beta',
    host: 'beta.example',
    username: 'ops',
    path: '/srv/app',
    machineKnown: true,
  })
  assert.equal(view.mainMachineId, 'c2')
  const implicit = rowOf(view.connections, 'c2')
  assert.equal(implicit.connected, true)
  assert.equal(implicit.implicit, true)
  assert.equal(implicit.canToggle, false)
  assert.equal(rowOf(view.connections, 'c1').connected, false)
  assert.equal(view.anyConnected, true)
})

test('a stored connection plus the implicit main machine both read as on', () => {
  const view = cockpitViewOf('ssh://c1/srv', MACHINES, ['c2'])

  assert.equal(rowOf(view.connections, 'c1').connected, true)
  assert.equal(rowOf(view.connections, 'c1').implicit, true)
  assert.equal(rowOf(view.connections, 'c1').canToggle, false)
  assert.equal(rowOf(view.connections, 'c2').connected, true)
  assert.equal(rowOf(view.connections, 'c2').implicit, false)
  assert.equal(rowOf(view.connections, 'c2').canToggle, true)
  assert.deepEqual(view.staleConnectionIds, [])
})

test('a cwd routing to a machine the registry lost is shown, but is not a connection', () => {
  const view = cockpitViewOf('ssh://ghost/srv/app', MACHINES, ['ghost'])

  assert.deepEqual(view.main, {
    kind: 'remote',
    machineId: 'ghost',
    label: 'ghost',
    host: '',
    username: '',
    path: '/srv/app',
    machineKnown: false,
  })
  // No implicit union for an unknown machine (the host's gate agrees), and no
  // row for it either: the panel never offers a toggle for a machine that the
  // registry does not carry.
  assert.equal(view.mainMachineId, undefined)
  assert.equal(view.anyConnected, false)
  assert.deepEqual(view.connections.map(row => row.id), ['c1', 'c2'])
  assert.deepEqual(view.staleConnectionIds, ['ghost'])
})

test('stale ids in the connection list render no row and never crash', () => {
  // Junk inside the wire value is dropped by `asConnectedIds` (see the parsing
  // case below); here the store holds well-formed ids the registry lost.
  const view = cockpitViewOf(undefined, MACHINES, asConnectedIds({ items: ['ghost', 'c1', 'ghost', 42, ''] }))

  assert.deepEqual(view.staleConnectionIds, ['ghost'])
  assert.deepEqual(view.connections.map(row => row.id), ['c1', 'c2'])
  assert.equal(rowOf(view.connections, 'c1').connected, true)
  assert.equal(view.anyConnected, true)
  assert.deepEqual(staleConnectionIdsOf(['ghost'], MACHINES), ['ghost'])
  assert.deepEqual(staleConnectionIdsOf(['c1'], MACHINES), [])
})

test('a store holding only stale ids shows the empty state', () => {
  const view = cockpitViewOf(undefined, MACHINES, ['ghost'])

  assert.equal(view.anyConnected, false)
  assert.deepEqual(view.connections.map(row => row.connected), [false, false])
})

test('a session with side roots only stays a local session', () => {
  const sides = asSideRows({
    items: [
      { id: 'sw-1', kind: 'local', rootKey: 'C:\\work\\logs', label: 'logs' },
      { id: 'sw-2', kind: 'remote', rootKey: 'ssh://c1/srv/data' },
    ],
  })
  const view = cockpitViewOf(undefined, MACHINES, [])

  assert.deepEqual(sides, [
    { id: 'sw-1', kind: 'local', rootKey: 'C:\\work\\logs', label: 'logs' },
    // A row without a label falls back to its root key (unchanged behaviour).
    { id: 'sw-2', kind: 'remote', rootKey: 'ssh://c1/srv/data', label: 'ssh://c1/srv/data' },
  ])
  assert.deepEqual(view.main, { kind: 'none' })
  assert.equal(view.anyConnected, false)
})

test('the toggle derivation names the endpoint and the singular id', () => {
  const view = cockpitViewOf(undefined, MACHINES, ['c1'])

  assert.deepEqual(toggleRequest('s1', rowOf(view.connections, 'c1')), {
    endpoint: 'session.conn.disconnect',
    payload: { sessionId: 's1', id: 'c1' },
  })
  assert.deepEqual(toggleRequest('s1', rowOf(view.connections, 'c2')), {
    endpoint: 'session.conn.connect',
    payload: { sessionId: 's1', id: 'c2' },
  })
})

test('the implicit main machine has no toggle, and a blank session id nothing to write to', () => {
  const view = cockpitViewOf('ssh://c1/srv', MACHINES, [])

  assert.equal(toggleRequest('s1', rowOf(view.connections, 'c1')), undefined)
  assert.equal(toggleRequest('   ', rowOf(view.connections, 'c2')), undefined)
})

test('wire parsing drops junk instead of building rows it cannot name', () => {
  const machines = asMachineRows({
    machines: [
      { id: 'c1', label: 'Alpha', host: 'alpha.example', username: 'dev' },
      { id: 'c2' },
      { id: 7 },
      null,
      'c3',
      { id: '   ' },
    ],
  })

  assert.deepEqual(machines, [
    { id: 'c1', label: 'Alpha', host: 'alpha.example', username: 'dev' },
    // A missing label falls back to the id; missing host/username to ''.
    { id: 'c2', label: 'c2', host: '', username: '' },
  ])
  assert.equal(asMachine(null), null)
  assert.deepEqual(asMachineRows(undefined), [])
  assert.deepEqual(asMachineRows({ machines: 'nope' }), [])
  assert.deepEqual(asSideRows({ items: [null, { id: 'x' }, { id: 'y', rootKey: '/k' }] }), [
    { id: 'y', kind: 'local', rootKey: '/k', label: '/k' },
  ])
  assert.deepEqual(asConnectedIds({ items: ['c1', '', ' c1 ', 5, 'c2'] }), ['c1', 'c2'])
  assert.deepEqual(asConnectedIds(undefined), [])
  assert.deepEqual(normalizeIds(['c1', 'c1', '', 1, 'c2']), ['c1', 'c2'])
})

test('the machine endpoint line stays honest about the fields it has', () => {
  assert.equal(machineEndpointOf({ host: 'h.example', username: 'u' }), 'u@h.example')
  assert.equal(machineEndpointOf({ host: 'h.example', username: '' }), 'h.example')
  assert.equal(machineEndpointOf({ host: '', username: 'u' }), '')
})

test('the panel derives through cockpit.ts and re-reads the connected store', () => {
  const panel = readFileSync(join(REPO, 'src', 'client', 'side-workspaces.tsx'), 'utf-8')
  const cockpit = readFileSync(join(REPO, 'src', 'client', 'cockpit.ts'), 'utf-8')

  // Every judgment comes from the pure module...
  assert.match(panel, /from '\.\/cockpit\.ts'/)
  assert.match(panel, /cockpitViewOf\(/)
  assert.match(panel, /toggleRequest\(sessionId, row\)/)
  // ...so the endpoints are spelled exactly once, in cockpit.ts.
  assert.doesNotMatch(panel, /'session\.conn\.(connect|disconnect)'/)
  assert.match(cockpit, /'session\.conn\.connect'/)
  assert.match(cockpit, /'session\.conn\.disconnect'/)
  // The connected set is READ after every mutation — no local source of truth.
  assert.match(panel, /'session\.conn\.list'/)
  // The pickOnly add-side flow is untouched.
  assert.match(panel, /<SshWorkspaceFlow/)
  assert.match(panel, /pickOnly/)
})
