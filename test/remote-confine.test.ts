/**
 * REQ-I13: remote initiator cwd must not wrap argv with the host runner.
 * @module test/remote-confine
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  installRemoteConfinePassthrough,
  passthroughConfinedArgv,
  shouldPassthroughRemoteConfine,
} from '../src/remote-confine.ts'

test('passthroughConfinedArgv: identity argv, full enforcement', () => {
  const out = passthroughConfinedArgv(['bash', '-c', 'echo'])
  assert.deepEqual(out.argv, ['bash', '-c', 'echo'])
  assert.equal(out.enforcement, 'full')
})

test('shouldPassthroughRemoteConfine: no initiator stays local', () => {
  assert.equal(shouldPassthroughRemoteConfine(new Context()), false)
})

test('shouldPassthroughRemoteConfine: ssh:// cwd is remote', () => {
  const ctx = new Context()
  ctx.provide('agents', {
    currentInitiator: () => ({ session: { header: { cwd: 'ssh://c1/work' } } }),
  })
  assert.equal(shouldPassthroughRemoteConfine(ctx), true)
})

test('installRemoteConfinePassthrough: remote cwd skips the inner confine', async () => {
  const ctx = new Context()
  let innerCalls = 0
  ctx.provide('sandbox', {
    confine(argv: readonly string[]) {
      innerCalls += 1
      return {
        argv: ['bwrap', '--', ...argv],
        enforcement: 'full' as const,
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  })
  ctx.provide('agents', {
    currentInitiator: () => ({ session: { header: { cwd: 'ssh://c1/work' } } }),
  })
  installRemoteConfinePassthrough(ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const sandbox = ctx.get('sandbox') as { confine: (argv: readonly string[], policy: { mode: string; workspaceRoot: string }) => { argv: string[] } }
  const out = sandbox.confine(['bash', '-c', 'echo'], { mode: 'workspace-write', workspaceRoot: '/work' })
  assert.deepEqual(out.argv, ['bash', '-c', 'echo'])
  assert.equal(innerCalls, 0)
})

test('installRemoteConfinePassthrough: local cwd still wraps', async () => {
  const ctx = new Context()
  ctx.provide('sandbox', {
    confine(argv: readonly string[]) {
      return {
        argv: ['bwrap', '--', ...argv],
        enforcement: 'full' as const,
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  })
  ctx.provide('agents', {
    currentInitiator: () => ({ session: { header: { cwd: process.cwd() } } }),
  })
  installRemoteConfinePassthrough(ctx)
  await new Promise(resolve => setTimeout(resolve, 0))
  const sandbox = ctx.get('sandbox') as { confine: (argv: readonly string[], policy: { mode: string; workspaceRoot: string }) => { argv: string[] } }
  const out = sandbox.confine(['bash', '-c', 'echo'], { mode: 'workspace-write', workspaceRoot: '/work' })
  assert.deepEqual(out.argv[0], 'bwrap')
})
