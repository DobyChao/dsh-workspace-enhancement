/**
 * BUG-12: the 0.2.0 shell seam is `resolve` + `execute` (no `run` / `start`).
 * The bridge must pin the world on the resolved spec and carry the one-call
 * sandbox policy into the spawn that `execute` performs.
 * @module test/bug-12-shell-execute
 */

import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import {
  currentRemoteSpawnPolicy,
  installRemoteSpawnPolicyBridge,
  isHostLocalShellExec,
} from '../src/remote-spawn-policy.ts'

type Spec = Record<string, unknown>

/** An executor shaped like `dsh-pwsh-local@0.2.0-rc.2`: `resolve` keeps only known fields. */
function provideShell(ctx: Context, onExecute: (spec: Spec) => Promise<unknown>): void {
  ctx.provide('shell', {
    resolve(request: Spec): Spec {
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: 1000,
        onExpiry: 'kill',
        stdoutMaxBytes: 1024,
        sandboxPolicy: request.sandboxPolicy,
      }
    },
    execute: onExecute,
  })
}

function shellOf(ctx: Context): { resolve: (r: Spec) => Spec; execute: (s: Spec) => Promise<unknown> } {
  return ctx.get('shell') as { resolve: (r: Spec) => Spec; execute: (s: Spec) => Promise<unknown> }
}

test('BUG-12: execute keeps the one-call sandboxPolicy across await and clears it after', async () => {
  const ctx = new Context()
  provideShell(ctx, async () => {
    await Promise.resolve()
    return currentRemoteSpawnPolicy()
  })
  installRemoteSpawnPolicyBridge(ctx)
  const shell = shellOf(ctx)
  const spec = shell.resolve({ command: 'echo', workdir: process.cwd(), sandboxPolicy: { mode: 'danger-full-access' } })
  assert.deepEqual(await shell.execute(spec), { mode: 'danger-full-access' })
  assert.equal(currentRemoteSpawnPolicy(), undefined)
})

test('BUG-12: resolve pins a remote workdir to the host world', () => {
  const ctx = new Context()
  provideShell(ctx, async () => undefined)
  installRemoteSpawnPolicyBridge(ctx)
  const shell = shellOf(ctx)
  if (process.platform === 'win32') {
    assert.equal(shell.resolve({ command: 'echo', workdir: 'ssh://c1/srv' }).workdir, homedir())
    return
  }
  assert.throws(() => shell.resolve({ command: 'echo', workdir: 'ssh://c1/srv' }), /Remote commands use sw_exec/)
})

test('BUG-12: the local-exec flag survives resolve and marks execute as host-local', async () => {
  const ctx = new Context()
  let seen: { local: boolean; flag: boolean } | undefined
  provideShell(ctx, async (spec) => {
    seen = { local: isHostLocalShellExec(), flag: 'dswLocalExec' in spec }
  })
  installRemoteSpawnPolicyBridge(ctx)
  const shell = shellOf(ctx)
  const spec = shell.resolve({ command: 'echo', workdir: '/home/me', dswLocalExec: true })
  assert.equal(spec.dswLocalExec, true)
  assert.equal(spec.workdir, '/home/me')
  await shell.execute(spec)
  assert.deepEqual(seen, { local: true, flag: false })
  assert.equal(isHostLocalShellExec(), false)
})
