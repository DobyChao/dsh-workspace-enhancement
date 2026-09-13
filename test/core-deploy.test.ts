/**
 * REQ-I5: deploy helpers are pure arch gates; no live SSH.
 * @module test/core-deploy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertLinuxAmd64 } from '../src/core-deploy.ts'
import { coreStatusLabel } from '../src/client/core-status.ts'

test('assertLinuxAmd64: linux + x86_64/amd64 accepted', () => {
  assert.doesNotThrow(() => assertLinuxAmd64('Linux', 'x86_64'))
  assert.doesNotThrow(() => assertLinuxAmd64('linux', 'amd64'))
})

test('assertLinuxAmd64: other kernels and aarch64 refused', () => {
  assert.throws(() => assertLinuxAmd64('Darwin', 'x86_64'), /linux only/)
  assert.throws(() => assertLinuxAmd64('Linux', 'aarch64'), /x86_64 only/)
})

test('coreStatusLabel: installed / missing / unsupported', () => {
  const t = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'settings.core.ok') return `ok:${String(params?.version)}${String(params?.arch ?? '')}`
    if (key === 'settings.core.unsupported') return `bad:${String(params?.detail)}`
    return `miss:${String(params?.detail)}`
  }
  assert.equal(coreStatusLabel({ ok: true, version: '0.2.0-dev', arch: 'x86_64' }, t), 'ok:0.2.0-dev x86_64')
  assert.equal(coreStatusLabel({ ok: false, detail: 'core not installed' }, t), 'miss:core not installed')
  assert.match(coreStatusLabel({ ok: false, detail: 'uname -s = Darwin' }, t), /^bad:/)
})
