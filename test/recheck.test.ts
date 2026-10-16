/**
 * UX-13 lab: the re-check control stays up after a probe settles, including
 * in the session-header remote-status block.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { headerRecheckLabelKey, recheckStaysVisible } from '../src/client/recheck.ts'
import { lookup } from '../src/locale/index.ts'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

test('UX-13: re-check stays visible for checking, reachable, and unreachable', () => {
  assert.equal(recheckStaysVisible('unknown'), true)
  assert.equal(recheckStaysVisible('active'), true)
  assert.equal(recheckStaysVisible('offline'), true)
  assert.equal(lookup('zh', headerRecheckLabelKey()), '重新检测')
  assert.equal(lookup('en', headerRecheckLabelKey()), 'Re-check')
})

test('UX-13: badges and the session header keep the re-check control in every state', () => {
  const header = read('../src/client/remote-status-entry.tsx')
  const badge = read('../src/client/status.tsx')
  const rows = read('../src/client/row-badges.ts')
  assert.match(header, /recheckStaysVisible\(state\)/)
  assert.match(header, /headerRecheckLabelKey\(\)/)
  assert.match(header, /data-dsw-action="reconnect"/)
  assert.doesNotMatch(header, /state !== 'active'/)
  assert.match(badge, /recheckStaysVisible\(state\)/)
  assert.doesNotMatch(badge, /state !== 'active'/)
  assert.match(rows, /recheckStaysVisible\(view\.state\)/)
  assert.doesNotMatch(rows, /state === 'active' \? 'none'/)
})
