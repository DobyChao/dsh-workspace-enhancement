/**
 * Row-badges status-marker regression tests (F0): markRowStatus and
 * rowStatusOf share ONE attribute (ROW_STATUS_KEY), so the write/read keys
 * cannot drift apart — the exact failure mode of the original bug, where
 * markRow wrote `data-dsw-marked` while paintConn read `data-dsw-conn-id`
 * and the badge state never advanced past `unknown`.
 *
 * The helpers are written against a structural dataset face (no jsdom / DOM
 * needed): HTMLElement.dataset satisfies the contract.
 * @module test/row-badges
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ROW_STATUS_KEY, clearRowStatus, isOwnBadgeMutation, markedRowStillQualifies, markRowStatus, remoteSessionIndex, remoteWorkspaceIndex, rowStatusOf, rowTitleOf } from '../src/client/row-badges.ts'

/** A minimal row stand-in carrying a real dataset record. */
function fakeRow(): { dataset: Record<string, string | undefined> } {
  return { dataset: {} }
}

/** One span face for rowTitleOf (structural; no DOM needed). */
function fakeSpan(text: string, opts: { icon?: boolean; badge?: boolean } = {}): {
  textContent: string
  querySelector(): unknown
  closest(): unknown
} {
  return {
    textContent: text,
    querySelector: () => (opts.icon ? {} : null),
    closest: () => (opts.badge ? {} : null),
  }
}

test('F0: markRowStatus writes the attribute rowStatusOf reads (single key)', () => {
  const row = fakeRow()
  assert.equal(markRowStatus(row, 'c1'), true)
  // The round trip: what was marked is what the paintConn-side read sees —
  // same key, same value (the original bug had two different keys).
  assert.equal(rowStatusOf(row), 'c1')
  assert.equal(row.dataset[ROW_STATUS_KEY], 'c1')
})

test('F0: markRowStatus is idempotent per connection', () => {
  const row = fakeRow()
  assert.equal(markRowStatus(row, 'c1'), true)
  assert.equal(markRowStatus(row, 'c1'), false) // same connection → untouched
  assert.equal(rowStatusOf(row), 'c1')
  // A different connection replaces the marker (the old badge belongs to a
  // row a React re-render would replace anyway).
  assert.equal(markRowStatus(row, 'c2'), true)
  assert.equal(rowStatusOf(row), 'c2')
})

test('F0: clearRowStatus removes the marker (dispose path)', () => {
  const row = fakeRow()
  markRowStatus(row, 'c1')
  clearRowStatus(row)
  assert.equal(rowStatusOf(row), undefined)
  assert.equal(row.dataset[ROW_STATUS_KEY], undefined)
})

/* ---------------- C3: same-title guard (local↔remote never mis-marks) ---------------- */

/** A route placeholder root; mirrors the host's `dsw-routes` spelling. */
const remotePath = (id: string): string => `C:\\dsh\\dsw-routes\\${id}\\home\\u`

test('C3: a remote title that also exists as a LOCAL workspace is not indexed', () => {
  const index = remoteWorkspaceIndex([
    { title: 'prod', path: remotePath('c1') }, // remote
    { title: 'prod', path: 'C:\\work\\prod' }, // LOCAL — same title
    { title: 'docs', path: remotePath('c2') }, // remote, unique
    { title: 'local-only', path: 'C:\\work\\x' },
  ])
  assert.equal(index.has('prod'), false) // 本地↔远程同名：跳过（C3）
  assert.equal(index.get('docs'), 'c2')
  assert.equal(index.has('local-only'), false)
})

test('C3: remote↔remote ambiguity still skips; the same connId twice still indexes', () => {
  const ambiguous = remoteWorkspaceIndex([
    { title: 'dev', path: remotePath('c1') },
    { title: 'dev', path: remotePath('c2') }, // two connections, one title
  ])
  assert.equal(ambiguous.has('dev'), false)
  const deduped = remoteWorkspaceIndex([
    { title: 'dev', path: remotePath('c1') },
    { title: 'dev', path: remotePath('c1') }, // one connection listed twice
  ])
  assert.equal(deduped.get('dev'), 'c1')
})

test('C3: flat-view index — a remote session title colliding with a local/unknown session is skipped', () => {
  const index = remoteSessionIndex([
    { title: 'demo', cwd: remotePath('c1') }, // remote
    { title: 'demo', cwd: 'C:\\work\\demo' }, // local — same title
    { title: 'lab', cwd: remotePath('c2') }, // remote, unique
    { title: 'ghost' }, // no cwd recorded (unjudgeable)
    { title: 'ghost', cwd: remotePath('c3') }, // collides with the unjudgeable one
  ])
  assert.equal(index.has('demo'), false) // 本地↔远程同名：跳过（C3）
  assert.equal(index.get('lab'), 'c2')
  assert.equal(index.has('ghost'), false) // 未记录 cwd 的同名会话也绝无误标
})

test('C3: a remote session with no title collision indexes normally', () => {
  const index = remoteSessionIndex([
    { title: 'api', cwd: remotePath('c4') },
    { title: 'api', cwd: remotePath('c5') },
  ])
  assert.equal(index.has('api'), false) // remote↔remote ambiguity kept
})

/* ---------------- C3 撤回: rebuild = withdraw stale, then re-mark ---------------- */

test('C3 撤回: a same-title local workspace appearing later withdraws the old badge', () => {
  const before = remoteWorkspaceIndex([{ title: 'prod', path: remotePath('c1') }])
  assert.equal(markedRowStillQualifies('c1', 'prod', before), true) // marked, still fine
  // Same title appears as a LOCAL workspace → the new index drops 'prod'…
  const after = remoteWorkspaceIndex([
    { title: 'prod', path: remotePath('c1') },
    { title: 'prod', path: 'C:\\work\\prod' },
  ])
  assert.equal(after.has('prod'), false)
  // …so the previously injected badge must be withdrawn before re-marking.
  assert.equal(markedRowStillQualifies('c1', 'prod', after), false)
})

test('C3 撤回: a deleted or renamed remote workspace withdraws the old badge', () => {
  const before = remoteWorkspaceIndex([{ title: 'docs', path: remotePath('c2') }])
  assert.equal(markedRowStillQualifies('c2', 'docs', before), true)
  // Remote workspace deleted → no index entry → withdraw.
  const deleted = remoteWorkspaceIndex([])
  assert.equal(markedRowStillQualifies('c2', 'docs', deleted), false)
  // Title renamed → the old title no longer maps to c2 → withdraw.
  const renamed = remoteWorkspaceIndex([{ title: 'docs-2', path: remotePath('c2') }])
  assert.equal(markedRowStillQualifies('c2', 'docs', renamed), false)
  // An unreadable title is withdrawn too (no title → nothing to match).
  assert.equal(markedRowStillQualifies('c2', null, before), false)
  // Unchanged index → the badge stays (no needless flicker).
  assert.equal(markedRowStillQualifies('c2', 'docs', before), true)
})

/* ---------------- C3 撤回 regression (t6): the badge must never be its own title ---------------- */

test('t6: rowTitleOf ignores the injected badge subtree (self-sustaining loop fix)', () => {
  // A real row: the title span PLUS our badge root span, whose textContent
  // (globe + state label + the display:none reconnect-button text, 7+ chars)
  // outgrew short titles — the old extractor returned IT, the C3 撤回 step
  // judged the row unmatched, and the badge was withdrawn + re-injected
  // every scan: the ≈430ms self-sustaining loop.
  const row = {
    querySelectorAll: () => [
      fakeSpan('zcode'),
      fakeSpan('🌐', { badge: true }),
      fakeSpan('未检测', { badge: true }),
      fakeSpan('重新检测', { badge: true }),
      fakeSpan('🌐未检测重新检测', { badge: true }),
    ],
  }
  assert.equal(rowTitleOf(row), 'zcode')
  // The REAL title drives C3 撤回 → the badge qualifies and is NOT withdrawn.
  const index = remoteWorkspaceIndex([{ title: 'zcode', path: remotePath('c1') }])
  assert.equal(markedRowStillQualifies('c1', rowTitleOf(row), index), true)
  // Guard: without the badge mark the same extractor output would have
  // withdrawn the badge (the t4→t5 failure mode).
  const unmarked = {
    querySelectorAll: () => [fakeSpan('zcode'), fakeSpan('🌐未检测重新检测')],
  }
  assert.equal(rowTitleOf(unmarked), '🌐未检测重新检测')
  assert.equal(markedRowStillQualifies('c1', rowTitleOf(unmarked), index), false)
})

test('rowTitleOf: the longest real span wins; icon and whitespace-only spans are skipped', () => {
  const row = {
    querySelectorAll: () => [
      fakeSpan('item'),
      fakeSpan('spans'),
      fakeSpan('', { icon: true }),
      fakeSpan('   '),
    ],
  }
  assert.equal(rowTitleOf(row), 'spans')
  assert.equal(rowTitleOf({ querySelectorAll: () => [] }), null)
})

test('t6: isOwnBadgeMutation — own badge-paint mutations never re-schedule a scan', () => {
  const badgeRoot = { closest: (selector: string) => (selector === '[data-dsw-badge]' ? badgeRoot : null) }
  const row = { closest: () => null }
  const labelInBadge = { closest: () => badgeRoot }
  // A paint write inside the badge subtree (label textContent) → self-induced.
  assert.equal(isOwnBadgeMutation(badgeRoot), true)
  assert.equal(isOwnBadgeMutation(labelInBadge), true)
  // A badge append/removal or an upstream re-render (target = the ROW).
  assert.equal(isOwnBadgeMutation(row), false)
  assert.equal(isOwnBadgeMutation(null), false)
  assert.equal(isOwnBadgeMutation(undefined), false)
})
