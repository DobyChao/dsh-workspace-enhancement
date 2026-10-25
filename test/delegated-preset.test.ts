/**
 * BUG-24: a subagent whose approval was pinned to `never` keeps the sandbox
 * preset name. It must not become Custom, and it must not be reported as
 * full access when the sandbox is still workspace-write.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { delegatedPresetName, installDelegatedPresetAlias } from '../src/delegated-preset.ts'
import type { DelegatedPermissionState, DelegatedPresetSpec } from '../src/delegated-preset.ts'

const PRESETS: Record<string, DelegatedPresetSpec> = {
  'read-only': { sandbox: 'read-only' },
  'workspace-write': { sandbox: 'workspace-write' },
  'danger-full-access': { sandbox: 'danger-full-access' },
}

test('BUG-24: never-approval custom aliases to the matching sandbox preset', () => {
  const state = (sandbox: string, approval: string): DelegatedPermissionState => ({ sandbox, approval })
  assert.equal(
    delegatedPresetName('custom', state('workspace-write', 'never'), PRESETS),
    'workspace-write',
  )
  assert.equal(
    delegatedPresetName('custom', state('read-only', 'never'), PRESETS),
    'read-only',
  )
  assert.equal(
    delegatedPresetName('danger-full-access', state('danger-full-access', 'never'), PRESETS),
    'danger-full-access',
  )
  assert.equal(
    delegatedPresetName('custom', state('workspace-write', 'ask'), PRESETS),
    'custom',
  )
  assert.equal(
    delegatedPresetName('custom', state('unlisted', 'never'), PRESETS),
    'custom',
  )
})

test('BUG-24: installing the alias wraps the live derive once', () => {
  const ctx = new Context()
  const service = {
    presets: PRESETS,
    derive(state: DelegatedPermissionState): string {
      if (state.sandbox === 'danger-full-access' && state.approval === 'never') return 'danger-full-access'
      if (state.approval === 'never') return 'custom'
      return 'workspace-write'
    },
  }
  ctx.provide('permissionPresets', service)
  installDelegatedPresetAlias(ctx)
  installDelegatedPresetAlias(ctx)
  assert.equal(service.derive({ sandbox: 'workspace-write', approval: 'never' }), 'workspace-write')
  assert.equal(service.derive({ sandbox: 'danger-full-access', approval: 'never' }), 'danger-full-access')
  assert.equal(service.derive({ sandbox: 'weird', approval: 'never' }), 'custom')
})
