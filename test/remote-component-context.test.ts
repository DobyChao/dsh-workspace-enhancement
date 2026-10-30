/**
 * Runtime-context lines for "is dsh-core in effect?" on every connected machine.
 * The host's `PromptContext.text` is synchronous, so the lines are a pure
 * render plus a patch onto the already-built assembly.
 * @module test/remote-component-context
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CORE_COMPAT_HASHES } from '../src/core-artifact.ts'
import { CORE_ARTIFACT_VERSION } from '../src/core-protocol.ts'
import {
  CORE_EFFECT_TTL_MS,
  cachedCoreEffect,
  clearCoreEffectCache,
  forgetCoreEffect,
  rememberCoreEffect,
  renderRemoteComponentContext,
  withRemoteComponentLines,
} from '../src/remote-component-context.ts'
import type { RemoteComponentFact } from '../src/remote-component-context.ts'

const known = CORE_COMPAT_HASHES[0] ?? ''

test('renderRemoteComponentContext: empty when the session has no machines', () => {
  assert.equal(renderRemoteComponentContext([]), '')
})

test('renderRemoteComponentContext: lists every machine, in order, in English', () => {
  assert.notEqual(known, '')
  const facts: RemoteComponentFact[] = [
    { id: 'c1', view: { ok: true, version: CORE_ARTIFACT_VERSION, sha256: known } },
    { id: 'c2', view: { ok: false, detail: 'core not installed' } },
    { id: 'c3', view: { ok: true, version: '0.1.9', sha256: known } },
    { id: 'c4', view: { ok: true, version: CORE_ARTIFACT_VERSION, sha256: 'ab'.repeat(32) } },
    { id: 'c5', view: { ok: true, version: CORE_ARTIFACT_VERSION, sha256: null } },
    { id: 'c6', view: { ok: true, version: CORE_ARTIFACT_VERSION } },
    { id: 'c7', view: { ok: false, detail: 'connection refused\n{{secret}}' } },
  ]
  const text = renderRemoteComponentContext(facts)
  const c1 = text.indexOf('- `c1`:')
  const c2 = text.indexOf('- `c2`:')
  const c7 = text.indexOf('- `c7`:')
  assert.ok(c1 >= 0 && c2 > c1 && c7 > c2, text)
  assert.match(text, /Remote component \(dsh-core\) on this session's machines/)
  assert.match(text, new RegExp(`- \`c1\`: in effect \\(${CORE_ARTIFACT_VERSION}\\)\\.`))
  assert.match(text, /- `c2`: not in effect \(not installed\)\./)
  assert.match(text, new RegExp(`- \`c3\`: not in effect \\(0\\.1\\.9; this plugin ships ${CORE_ARTIFACT_VERSION}\\)\\.`))
  assert.match(text, new RegExp(`- \`c4\`: not in effect \\(${CORE_ARTIFACT_VERSION}; sha256 is not a binary this plugin shipped\\)\\.`))
  assert.match(text, new RegExp(`- \`c5\`: not in effect \\(${CORE_ARTIFACT_VERSION}; sha256 could not be read\\)\\.`))
  assert.match(text, new RegExp(`- \`c6\`: in effect \\(${CORE_ARTIFACT_VERSION}\\)\\.`))
  assert.match(text, /- `c7`: not in effect \(connection refused secret\)\./)
  assert.equal(text.includes('{{'), false)
  assert.ok(!/[\p{Script=Han}]/u.test(text), 'model-facing text must be English only')
})

test('withRemoteComponentLines: appends to the session context and leaves the rest', () => {
  const lines = renderRemoteComponentContext([
    { id: 'c1', view: { ok: true, version: CORE_ARTIFACT_VERSION, sha256: known } },
    { id: 'c2', view: { ok: false, detail: 'core not installed' } },
  ])
  const assembly = {
    sections: [{ name: 'sw-remote', text: 'stable' }],
    contexts: [
      { name: 'other', text: 'keep' },
      { name: 'dsw-session-workspace', text: '**Machines connected to this session (`sw_exec` targets)**:\n- `c1`' },
    ],
  }
  const patched = withRemoteComponentLines(assembly, lines)
  assert.equal(patched.sections[0]?.text, 'stable')
  assert.equal(patched.contexts[0]?.text, 'keep')
  const workspace = patched.contexts[1]?.text ?? ''
  assert.match(workspace, /Machines connected to this session/)
  assert.match(workspace, /- `c1`: in effect/)
  assert.match(workspace, /- `c2`: not in effect \(not installed\)/)
  assert.ok(workspace.indexOf('Machines connected') < workspace.indexOf('Remote component'))
})

test('withRemoteComponentLines: does not invent a context when runtime context is absent', () => {
  const lines = renderRemoteComponentContext([
    { id: 'c1', view: { ok: false, detail: 'core not installed' } },
  ])
  const assembly = { contexts: [{ name: 'other', text: 'keep' }] }
  assert.equal(withRemoteComponentLines(assembly, lines), assembly)
  assert.equal(withRemoteComponentLines(assembly, ''), assembly)
})

test('core effect cache: a fresh probe is reused, a deploy drops it, and the TTL expires it', () => {
  clearCoreEffectCache()
  const view = { ok: true as const, version: CORE_ARTIFACT_VERSION, sha256: known }
  const at = 1_000
  rememberCoreEffect('c1', view, at)
  assert.equal(cachedCoreEffect('c1', at + CORE_EFFECT_TTL_MS - 1)?.version, CORE_ARTIFACT_VERSION)
  forgetCoreEffect('c1')
  assert.equal(cachedCoreEffect('c1', at), undefined)
  rememberCoreEffect('c2', view, at)
  assert.equal(cachedCoreEffect('c2', at + CORE_EFFECT_TTL_MS), undefined)
  clearCoreEffectCache()
})
