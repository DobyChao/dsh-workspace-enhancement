/**
 * Pure helpers for inheriting official core hashes. The registry walk itself
 * is the release workflow, not this test.
 * @module test/inherit-core-hashes
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashesFromArtifactModule, hashesToAdd, npmCliCandidates } from '../scripts/inherit-published-core-hashes.mjs'

test('hashesFromArtifactModule reads only the compat list', () => {
  const source = `
export const CORE_ARTIFACT_VERSION = '0.2.2'
export const CORE_COMPAT_HASHES = [
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
] as const
`
  assert.deepEqual(hashesFromArtifactModule(source), [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ])
  assert.deepEqual(hashesFromArtifactModule('export const CORE_ARTIFACT_VERSION = "0.2.2"'), [])
})

test('hashesToAdd keeps the existing order and skips duplicates', () => {
  const current = ['aa'.repeat(32)]
  const incoming = ['aa'.repeat(32), 'bb'.repeat(32), 'not-a-hash', 'bb'.repeat(32)]
  assert.deepEqual(hashesToAdd(current, incoming), ['bb'.repeat(32)])
})

test('npmCliCandidates covers the Windows layout and the setup-node layout', () => {
  const candidates = npmCliCandidates(process.platform === 'win32' ? 'C:\\node\\node.exe' : '/usr/local/bin/node')
  assert.equal(candidates.length, 2)
  assert.ok(candidates[0].includes('node_modules'))
  assert.ok(candidates[1].replaceAll('\\', '/').endsWith('lib/node_modules/npm/bin/npm-cli.js'))
})
