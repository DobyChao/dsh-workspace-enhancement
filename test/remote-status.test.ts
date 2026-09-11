/**
 * Remote-status header entry tests (t4): the pure judgments behind the
 * official-slot entry — slot/entry identity, session→connection resolution over
 * every accepted cwd spelling, the render decision (remote vs local), the seat
 * wiring over the session feed, and the re-mount contract (a second mount must
 * never hit the registry's "already registered" guard).
 * @module test/remote-status
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMOTE_STATUS_ENTRY_ID,
  REMOTE_STATUS_ORDER,
  REMOTE_STATUS_SLOT,
  createRemoteStatusSeats,
  remoteConnectionIdOf,
  remoteStatusRegisterOptions,
  showsRemoteStatus,
} from '../src/client/remote-status.ts'
import type { RemoteSessionsFeed } from '../src/client/remote-status.ts'
import { lookup } from '../src/locale/index.ts'
import type { DswKey } from '../src/locale/index.ts'

/** The sibling entry that already owns the header strip (index.ts, order 25). */
const SIDE_ENTRY_ID = 'dsh-workspace-enhancement-side'

/** zh translate seat (the dictionary's own lookup — the same chain as the app). */
const tZh = (key: DswKey, params?: Record<string, unknown>): string => lookup('zh', key, params)
/** en translate seat. */
const tEn = (key: DswKey, params?: Record<string, unknown>): string => lookup('en', key, params)

/**
 * Minimal SlotCore clone: one row identity per (slot, id), a duplicate live
 * registration throws (the framework guard our re-mount contract is about),
 * disposers are idempotent, and `inject` runs the generator once its slot is
 * declared.
 */
class MiniSlots {
  private readonly live = new Map<string, number>()
  private readonly declared = new Set<string>([REMOTE_STATUS_SLOT])
  private readonly effects: Array<() => void> = []

  register(options: { name: string; id?: string; order?: number }, _component: unknown): () => void {
    const key = `${options.name}\u0000${options.id ?? ''}`
    if (this.live.has(key)) throw new Error(`already registered: ${options.id ?? ''}`)
    this.live.set(key, options.order ?? 0)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.live.delete(key)
    }
  }

  inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void {
    if (!this.declared.has(key)) return () => {}
    const produced = callback()
    const disposers = typeof produced === 'function' ? [produced] : [...produced]
    this.effects.push(...disposers)
    return () => { for (const dispose of disposers) dispose() }
  }

  rows(): number {
    return this.live.size
  }
}

test('t4: the entry resolves every accepted remote cwd spelling', () => {
  assert.equal(remoteConnectionIdOf('ssh://c1/srv/app'), 'c1')
  // The placeholder tree the host's `session.route` hands the client.
  assert.equal(remoteConnectionIdOf('C:\\Users\\dev\\.dsh\\dsw-routes\\c1\\srv\\app'), 'c1')
  assert.equal(remoteConnectionIdOf('/home/dev/.dsh/dsw-routes/c1/srv/app'), 'c1')
  // The pre-rename tree stays routable (live sessions).
  assert.equal(remoteConnectionIdOf('/home/dev/.dsh/dsh-ssh-routes/c2/srv'), 'c2')
  // A trailing route with no path still names the connection.
  assert.equal(remoteConnectionIdOf('ssh://c3'), 'c3')
})

test('t4: a local or malformed cwd is never guessed into a connection', () => {
  assert.equal(remoteConnectionIdOf(undefined), undefined)
  assert.equal(remoteConnectionIdOf(''), undefined)
  assert.equal(remoteConnectionIdOf('/home/dev/project'), undefined)
  assert.equal(remoteConnectionIdOf('C:\\Users\\dev\\project'), undefined)
  // A placeholder-looking path with no valid id segment stays local.
  assert.equal(remoteConnectionIdOf('/home/dev/.dsh/dsw-routes/'), undefined)
  assert.equal(remoteConnectionIdOf('ssh://bad id/app'), undefined)
})

test('t4: the render decision is remote-only (local sessions show nothing)', () => {
  assert.equal(showsRemoteStatus({ cwd: '/home/dev/.dsh/dsw-routes/c1/srv' }), true)
  assert.equal(showsRemoteStatus({ cwd: 'ssh://c1/srv' }), true)
  assert.equal(showsRemoteStatus({ cwd: '/home/dev/project' }), false)
  assert.equal(showsRemoteStatus({}), false)
  // No row yet / no store at all: hidden, never a throw.
  assert.equal(showsRemoteStatus(undefined), false)
})

test('t4: the seats project the live session feed and forward its changes', () => {
  let byId: Record<string, { cwd?: string }> = { s1: { cwd: 'ssh://c1/srv' }, s2: {} }
  const listeners = new Set<() => void>()
  const feed: RemoteSessionsFeed = {
    getSnapshot: () => ({ byId }),
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  const seats = createRemoteStatusSeats(() => feed)
  assert.deepEqual(seats.remoteFacts('s1'), { cwd: 'ssh://c1/srv' })
  // A row without a recorded cwd is present but not remote.
  assert.deepEqual(seats.remoteFacts('s2'), {})
  assert.equal(showsRemoteStatus(seats.remoteFacts('s2')), false)
  // No row at all: undefined (the entry hides).
  assert.equal(seats.remoteFacts('missing'), undefined)

  let notified = 0
  const unsubscribe = seats.subscribeRemote(() => { notified += 1 })
  byId = { s1: { cwd: '/home/dev/project' } }
  for (const fn of listeners) fn()
  assert.equal(notified, 1)
  assert.equal(showsRemoteStatus(seats.remoteFacts('s1')), false)
  unsubscribe()
  assert.equal(listeners.size, 0)

  // Without the service the seats degrade instead of throwing.
  const absent = createRemoteStatusSeats(() => undefined)
  assert.equal(absent.remoteFacts('s1'), undefined)
  const noop = absent.subscribeRemote(() => {})
  assert.equal(typeof noop, 'function')
  noop()
  // A half-built or renamed feed (here: the `sessions` FACE mistaken for the
  // store) is treated as absent — the header render must never throw.
  const malformed = createRemoteStatusSeats(
    () => ({ getSnapshot: () => ({ byId: {} }) }) as unknown as RemoteSessionsFeed,
  )
  assert.equal(malformed.remoteFacts('s1'), undefined)
  const noop2 = malformed.subscribeRemote(() => {})
  assert.equal(typeof noop2, 'function')
  noop2()
})

test('t4: the registration targets the utilities seat under its own row identity', () => {
  const options = remoteStatusRegisterOptions(tZh)
  assert.equal(options.name, REMOTE_STATUS_SLOT)
  assert.equal(options.name, 'conversation.session.header.utilities')
  // The title-adjacent ACTION group is NOT used: one seat only, never both.
  assert.notEqual(options.name, 'conversation.session.header.actions')
  assert.equal(options.id, REMOTE_STATUS_ENTRY_ID)
  assert.equal(options.id, 'dsh-workspace-enhancement-remote')
  // The side-workspaces entry keeps its own id and its own seat.
  assert.notEqual(options.id, SIDE_ENTRY_ID)
  assert.equal(options.order, 26)
  assert.ok(options.order > 0, 'a positive order sorts after the shipped default-0 utilities')
  assert.equal(options.locale, 'dsw')
  // The label resolves through the live seat, per language.
  assert.equal(options.label(), '远程状态')
  assert.equal(remoteStatusRegisterOptions(tEn).label(), 'Remote status')
})

test('t4: a re-install never hits the duplicate-registration guard', () => {
  const slots = new MiniSlots()
  const mount = (): (() => void) => slots.inject(REMOTE_STATUS_SLOT, () =>
    slots.register(remoteStatusRegisterOptions(tZh), () => null))
  const first = mount()
  assert.equal(slots.rows(), 1)
  // The guard is real: a second LIVE registration of the same row id is refused,
  // which is exactly the "already registered" a re-install must never hit.
  assert.throws(() => mount(), /already registered/)
  // Unmount, then re-install: the registry is clean again, no duplicate throw.
  first()
  first() // disposal is idempotent
  assert.equal(slots.rows(), 0)
  const second = mount()
  assert.equal(slots.rows(), 1)
  second()
  assert.equal(slots.rows(), 0)
  // A third cycle proves no stale state survived either teardown.
  const third = mount()
  assert.equal(slots.rows(), 1)
  third()
  assert.equal(slots.rows(), 0)
})

test('t4: the two new dictionary keys resolve in both languages', () => {
  assert.equal(lookup('zh', 'header.remote.label'), '远程状态')
  assert.equal(lookup('en', 'header.remote.label'), 'Remote status')
  assert.equal(
    lookup('zh', 'header.remote.title', { machine: 'prod' }),
    '当前会话的远程连接：prod（点击重新检测）',
  )
  assert.equal(
    lookup('en', 'header.remote.title', { machine: 'prod' }),
    'Remote connection of this session: prod (click to re-check)',
  )
})
