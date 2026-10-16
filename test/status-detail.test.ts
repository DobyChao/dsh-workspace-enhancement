/**
 * Reachability tooltip for a stored host-key mismatch (UX-13).
 * The badge stays unreachable. The detail is the locale phrase, not a
 * network failure.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOST_KEY_CHANGED, hostKeyConnectError } from '../src/host-key-changed.ts'
import { statusTooltip } from '../src/client/status-detail.ts'
import { lookup } from '../src/locale/index.ts'

test('UX-13: a host-key mismatch tooltip is 主机密钥已变更 / Host key changed', () => {
  const zh = lookup('zh', 'status.hostKey.changed')
  const en = lookup('en', 'status.hostKey.changed')
  assert.equal(zh, '主机密钥已变更')
  assert.equal(en, 'Host key changed')
  assert.equal(statusTooltip(HOST_KEY_CHANGED, '不可连接', zh), '主机密钥已变更')
  assert.equal(statusTooltip(`dsw: ${HOST_KEY_CHANGED}`, 'Unreachable', en), 'Host key changed')
  assert.equal(statusTooltip('ssh: handshake failed', '不可连接', zh), 'ssh: handshake failed')
  assert.equal(statusTooltip(undefined, '不可连接', zh), '不可连接')
  assert.equal(statusTooltip('', 'Unreachable', en), 'Unreachable')
})

test('UX-13: a changed host key rewrites to the marker; a network failure does not', () => {
  const changed = hostKeyConnectError('changed', 'host key for h:22 CHANGED (stored a, received b)')
  assert.equal(changed?.message, 'dsw: host-key-changed')
  assert.equal(hostKeyConnectError('unknown', 'unknown host key for h:22')?.message, 'dsw: unknown host key for h:22')
  assert.equal(hostKeyConnectError(null, null), null)
  assert.equal(hostKeyConnectError(null, ''), null)
})
