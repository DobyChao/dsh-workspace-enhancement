/**
 * Settings-page save banner tests (F2): after an edit-save the machine form
 * remounts (`key={editing?.id}`) and any in-form feedback vanishes with it,
 * so the durable acknowledgment lives on the page — `savedBanner` builds that
 * text and must keep the honest plaintext-fallback marker.
 * @module test/settings-banner
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { savedBanner } from '../src/client/settings.tsx'

test('F2: the page-level banner names the saved machine', () => {
  assert.equal(savedBanner({ id: 'c1', label: 'prod', host: 'p', port: 22, username: 'u' }), '已保存 prod')
  // The display-name fallback keeps user@host.
  assert.equal(savedBanner({ id: 'c1', label: '', host: 'p', port: 22, username: 'u' }), '已保存 u@p')
})

test('F2: the honest encryption-fallback marker rides the page banner', () => {
  const banner = savedBanner({ id: 'c1', label: 'prod', host: 'p', port: 22, username: 'u', encryptFallback: true })
  assert.match(banner, /已保存 prod/)
  assert.match(banner, /加密后端不可用/)
})
