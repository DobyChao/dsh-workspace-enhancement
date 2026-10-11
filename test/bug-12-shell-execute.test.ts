/**
 * BUG-12: the 0.2.0 shell seam is `resolve` + `execute` (no `run` / `start`).
 * The bridge pins the world on the resolved spec and re-stamps the local-exec
 * flag. REQ-I27 retired its policy store: `spec.sandboxPolicy` now flows to
 * the executor VERBATIM (no bridging needed) and the policy channel into the
 * remote spawn is the confine mark registry instead (ADR-0031 §3.1).
 * @module test/bug-12-shell-execute
 */

import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { confinedSpawnMarkOf, markConfinedArgv } from '../src/remote-confine-policy.ts'
import { installRemoteSpawnPolicyBridge, isHostLocalShellExec } from '../src/remote-spawn-policy.ts'

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

test('BUG-12/REQ-I27: execute receives spec.sandboxPolicy verbatim — no bridge store any more', async () => {
  const ctx = new Context()
  let seen: unknown
  provideShell(ctx, async (spec) => {
    await Promise.resolve()
    seen = spec.sandboxPolicy
  })
  installRemoteSpawnPolicyBridge(ctx)
  const shell = shellOf(ctx)
  const spec = shell.resolve({ command: 'echo', workdir: process.cwd(), sandboxPolicy: { mode: 'danger-full-access' } })
  await shell.execute(spec)
  // The one-call policy rides the SPEC (official escalation stamps it there);
  // the retired ALS bridge was only ever a workaround for spawns reading it.
  assert.deepEqual(seen, { mode: 'danger-full-access' })
})

test('BUG-12/REQ-I27: the spawn policy channel is the confine mark — sandboxPolicy needs no bridging', () => {
  // A danger grant SKIPS confine (official semantics) ⇒ the spawn argv stays
  // UNMARKED ⇒ the remote spawn runs `--sandbox off` — exactly the grant.
  const granted = ['pwsh', '-Command', 'Set-Content x']
  assert.equal(confinedSpawnMarkOf(granted), undefined)
  // A confined call goes THROUGH confine ⇒ the returned argv IS the mark.
  const product = markConfinedArgv(['bash', '-c', 'make'], { mode: 'workspace-write' })
  assert.deepEqual(confinedSpawnMarkOf(product.argv), { mode: 'workspace-write' })
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
