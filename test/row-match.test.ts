/**
 * UX-8 option A: a sidebar badge follows `data-row-key`, and falls back to
 * the title index only when the host build has no key (0.1.5) or the feed
 * does not know that id yet.
 * @module test/row-match
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  connIdForGroupedSession,
  connIdForSessionRow,
  connIdForWorkspaceRow,
  parseRowKey,
  remoteWorkspaceIndex,
  workspaceIdOf,
} from '../src/client/row-match.ts'
import type { RemoteSessionRow, RemoteWorkspaceRow } from '../src/client/row-match.ts'

const remotePath = (id: string): string => `/home/dev/.dsh/dsw-routes/${id}/srv/app`

test('UX-8 parseRowKey: workspace and session keys, and nothing else', () => {
  assert.deepEqual(parseRowKey('workspace:w1'), { kind: 'workspace', id: 'w1' })
  assert.deepEqual(parseRowKey('session:s1'), { kind: 'session', id: 's1' })
  assert.equal(parseRowKey('workspace:'), null)
  assert.equal(parseRowKey('other:w1'), null)
  assert.equal(parseRowKey(null), null)
  assert.equal(parseRowKey(undefined), null)
  assert.equal(workspaceIdOf({ workspaceId: 'w1' }), 'w1')
  assert.equal(workspaceIdOf({}), undefined)
  assert.equal(workspaceIdOf({ workspaceId: '' }), undefined)
})

test('UX-8: a workspace key badges the remote row even when a local row shares the title', () => {
  const workspaces: RemoteWorkspaceRow[] = [
    { workspaceId: 'remote', title: 'prod', path: remotePath('c1') },
    { workspaceId: 'local', title: 'prod', path: '/home/dev/prod' },
  ]
  // The title index still refuses the collision (0.1.5 fallback).
  assert.equal(remoteWorkspaceIndex(workspaces).has('prod'), false)
  assert.equal(connIdForWorkspaceRow({ rowKey: null, title: 'prod' }, workspaces), undefined)
  assert.equal(
    connIdForWorkspaceRow({ rowKey: 'workspace:remote', title: 'prod' }, workspaces),
    'c1',
  )
  // The key that names the local workspace must not hop to the remote one.
  assert.equal(
    connIdForWorkspaceRow({ rowKey: 'workspace:local', title: 'prod' }, workspaces),
    undefined,
  )
})

test('UX-8: no data-row-key falls back to an unambiguous remote title', () => {
  const workspaces: RemoteWorkspaceRow[] = [
    { title: 'docs', path: remotePath('c2') },
    { title: 'local-only', path: '/srv/local' },
  ]
  assert.equal(connIdForWorkspaceRow({ rowKey: null, title: 'docs' }, workspaces), 'c2')
  assert.equal(connIdForWorkspaceRow({ rowKey: null, title: 'local-only' }, workspaces), undefined)
})

test('UX-8: an unknown workspace key falls back to the title index', () => {
  const workspaces: RemoteWorkspaceRow[] = [
    { title: 'docs', path: remotePath('c2') },
  ]
  assert.equal(
    connIdForWorkspaceRow({ rowKey: 'workspace:missing', title: 'docs' }, workspaces),
    'c2',
  )
})

test('UX-8: two remote workspaces with one key and disagreeing machines are not badged', () => {
  const workspaces: RemoteWorkspaceRow[] = [
    { workspaceId: 'same', title: 'a', path: remotePath('c1') },
    { workspaceId: 'same', title: 'b', path: remotePath('c2') },
  ]
  assert.equal(connIdForWorkspaceRow({ rowKey: 'workspace:same', title: 'a' }, workspaces), undefined)
})

test('UX-8: a session key follows that session, including a local one', () => {
  const sessions: RemoteSessionRow[] = [
    { sessionId: 's-remote', title: 'demo', cwd: remotePath('c1') },
    { sessionId: 's-local', title: 'demo', cwd: '/home/dev/demo' },
  ]
  assert.equal(connIdForSessionRow({ rowKey: 'session:s-remote', title: 'demo' }, sessions), 'c1')
  assert.equal(connIdForSessionRow({ rowKey: 'session:s-local', title: 'demo' }, sessions), undefined)
  // No key: the title collision is skipped.
  assert.equal(connIdForSessionRow({ rowKey: null, title: 'demo' }, sessions), undefined)
})

test('UX-8: a grouped session with no key inherits the group; a known key does not', () => {
  const sessions: RemoteSessionRow[] = [
    { sessionId: 's-other', title: 'child', cwd: remotePath('c2') },
    { sessionId: 's-local', title: 'local-child', cwd: '/tmp/local' },
  ]
  assert.equal(
    connIdForGroupedSession({ rowKey: null, title: 'child' }, sessions, 'c1'),
    'c1',
  )
  assert.equal(
    connIdForGroupedSession({ rowKey: 'session:s-other', title: 'child' }, sessions, 'c1'),
    'c2',
  )
  assert.equal(
    connIdForGroupedSession({ rowKey: 'session:s-local', title: 'local-child' }, sessions, 'c1'),
    undefined,
  )
  // A key the feed has not caught up with still inherits.
  assert.equal(
    connIdForGroupedSession({ rowKey: 'session:later', title: 'child' }, sessions, 'c1'),
    'c1',
  )
})
