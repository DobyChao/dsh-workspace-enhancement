/**
 * REQ-I13: session `/permission` maps onto core `--sandbox`.
 * @module test/remote-policy
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  coreServeSandboxOf,
  isConfinedSandboxMode,
  resolveRemoteSessionMode,
  sandboxModeFromPolicy,
} from '../src/remote-policy.ts'

test('coreServeSandboxOf: danger is off; confined modes keep their name', () => {
  assert.equal(coreServeSandboxOf('danger-full-access'), 'off')
  assert.equal(coreServeSandboxOf('read-only'), 'read-only')
  assert.equal(coreServeSandboxOf('workspace-write'), 'workspace-write')
})

test('isConfinedSandboxMode: only danger is unconfined', () => {
  assert.equal(isConfinedSandboxMode('read-only'), true)
  assert.equal(isConfinedSandboxMode('workspace-write'), true)
  assert.equal(isConfinedSandboxMode('danger-full-access'), false)
})

test('sandboxModeFromPolicy: reads a policy object or a bare mode', () => {
  assert.equal(sandboxModeFromPolicy('workspace-write'), 'workspace-write')
  assert.equal(sandboxModeFromPolicy({ mode: 'danger-full-access' }), 'danger-full-access')
  assert.equal(sandboxModeFromPolicy({}), undefined)
})

test('resolveRemoteSessionMode: explicit overlay wins; else fail-safe read-only', () => {
  const ctx = new Context()
  assert.equal(resolveRemoteSessionMode(ctx, { mode: 'danger-full-access' }), 'danger-full-access')
  assert.equal(resolveRemoteSessionMode(ctx), 'read-only')
})

test('resolveRemoteSessionMode: sandboxPolicy.resolve is the session default', () => {
  const ctx = new Context()
  ctx.provide('sandboxPolicy', {
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/work' }),
  })
  assert.equal(resolveRemoteSessionMode(ctx), 'workspace-write')
  assert.equal(resolveRemoteSessionMode(ctx, { mode: 'read-only' }), 'read-only')
})
