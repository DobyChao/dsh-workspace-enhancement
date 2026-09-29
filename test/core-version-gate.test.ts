/**
 * REQ-I17: fenced work only ever runs THIS plugin's core artifact —
 * `hello.version` ≠ `CORE_ARTIFACT_VERSION` refuses spawn/write with a
 * deploy-prompting `SANDBOX_UNAVAILABLE`; danger degrades to `CoreMissingError`
 * (SFTP fallback, "danger/off 不挡"). REQ-I14: a confined open on a verifiably
 * missing/stale DISK artifact asks the gap resolver once and retries.
 * @module test/core-version-gate
 */

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CoreClient } from '../src/core-client.ts'
import { serveFakeCore } from '../src/core-fake.ts'
import { CORE_ARTIFACT_VERSION } from '../src/core-protocol.ts'
import { createCoreHub } from '../src/core-hub.ts'
import { REMOTE_SANDBOX_MESSAGES, REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import { CoreMissingError, isCoreMissingError } from '../src/remote-policy.ts'
import type { RemoteSandboxDeps, RemoteSandboxMachineFace } from '../src/remote-sandbox-fence.ts'
import type { ExecOutcome } from '../src/ssh-core.ts'
import type { SshTransport } from '../src/transport.ts'

/** Fake-core-backed client whose hello advertises the given version. */
function pair(root: string, version: string = CORE_ARTIFACT_VERSION): CoreClient {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  serveFakeCore(toServer, toClient, { root, sandbox: 'read-only', version })
  return new CoreClient(toServer, toClient)
}

function execOutcome(stdout = '', exitCode = 0): ExecOutcome {
  return { exitCode, signal: null, stdout, stderr: '' }
}

/**
 * A connection face whose `exec` answers the on-disk version probe with the
 * canned `diskVersion` (exit 1 = no core installed) and nothing else.
 */
function diskConnection(diskVersion: string | null): { exec(command: string): Promise<ExecOutcome> } {
  return {
    exec: async (command: string) => {
      if (command.includes('dsh-core version')) {
        return diskVersion === null
          ? execOutcome('not found', 1)
          : execOutcome(`${JSON.stringify({ version: diskVersion, arch: 'x86_64', proto: 1, caps: [] })}\n`)
      }
      return execOutcome()
    },
  }
}

function deps(diskVersion: string | null = null): RemoteSandboxDeps {
  const machine: RemoteSandboxMachineFace = { id: 'c1', remoteSandbox: 'read-only', workspace: '/work', cwd: '/work' }
  const connection = diskConnection(diskVersion)
  return {
    machine: (id) => (id === 'c1' ? machine : undefined),
    connection: (id) => (id === 'c1' ? connection as never : undefined),
    unavailable: (confinement, detail) => new RemoteSandboxError(`${confinement}: ${detail}`, REMOTE_SANDBOX_UNAVAILABLE),
  }
}

function ctxWith(): Context {
  const ctx = new Context()
  ctx.provide('sshRegistry', { get: () => undefined })
  return ctx
}

function root(): string {
  return mkdtempSync(join(tmpdir(), 'dsw-core-vergate-'))
}

test('REQ-I17: stale hello.version refuses confined work with the deploy prompt', async () => {
  const stale = pair(root(), '0.0.1-old')
  let opens = 0
  const hub = createCoreHub(ctxWith(), {
    deps: deps(),
    open: async () => {
      opens += 1
      return stale
    },
  })
  await assert.rejects(
    () => hub.require('c1'),
    (error: unknown) => error instanceof RemoteSandboxError
      && error.code === REMOTE_SANDBOX_UNAVAILABLE
      && error.message.includes('0.0.1-old')
      && error.message.includes(CORE_ARTIFACT_VERSION)
      && error.message.includes(REMOTE_SANDBOX_MESSAGES.coreVersionMismatch.slice(0, 30)),
  )
  // The refusal is cached: the second confined caller fails fast, no re-open.
  await assert.rejects(() => hub.require('c1'))
  assert.equal(opens, 1)
  stale.close()
})

test('REQ-I17: close() clears the cached version refusal (post-deploy reopen)', async () => {
  const stale = pair(root(), '0.0.1-old')
  const fresh = pair(root())
  let opens = 0
  const hub = createCoreHub(ctxWith(), {
    deps: deps(),
    open: async () => {
      opens += 1
      return opens === 1 ? stale : fresh
    },
  })
  await assert.rejects(() => hub.require('c1'), RemoteSandboxError)
  hub.close('c1')
  const client = await hub.require('c1')
  assert.equal(client, fresh)
  fresh.close()
  stale.close()
})

test('REQ-I17: danger policy degrades a stale core to CoreMissingError (SFTP fallback), never a fence refusal', async () => {
  const stale = pair(root(), '0.0.1-old')
  const hub = createCoreHub(ctxWith(), {
    deps: deps(),
    open: async () => stale,
  })
  await assert.rejects(
    () => hub.require('c1', { policy: 'danger-full-access' }),
    (error: unknown) => isCoreMissingError(error) && !(error instanceof RemoteSandboxError),
  )
  stale.close()
})

test('REQ-I17: the matching artifact still opens (the gate is exact, not paranoid)', async () => {
  const fresh = pair(root())
  const hub = createCoreHub(ctxWith(), { deps: deps(), open: async () => fresh })
  const client = await hub.require('c1')
  assert.equal(client, fresh)
  fresh.close()
})

test('REQ-I14: resolver flow (stale disk → ask → deploy → retry) — see core-provision for the asker', async () => {
  const fresh = pair(root())
  let calls = 0
  const facts: Array<{ found: string | undefined; expected: string }> = []
  const hub = createCoreHub(ctxWith(), {
    deps: deps('0.0.1-old'),
    open: async () => {
      calls += 1
      if (calls === 1) throw new Error('core stdout closed: not found')
      return fresh
    },
    resolveGap: async (_id, f) => {
      facts.push({ found: f.found, expected: f.expected })
      return true
    },
  })
  const client = await hub.require('c1')
  assert.equal(client, fresh)
  assert.deepEqual(facts, [{ found: '0.0.1-old', expected: CORE_ARTIFACT_VERSION }])
  fresh.close()
})

test('REQ-I14: a denied resolution falls through to the fail-closed refusal, cached', async () => {
  let calls = 0
  let asks = 0
  const hub = createCoreHub(ctxWith(), {
    deps: deps(null),
    open: async () => {
      calls += 1
      throw new Error('core stdout closed: not found')
    },
    resolveGap: async () => {
      asks += 1
      return false
    },
  })
  await assert.rejects(() => hub.require('c1'), RemoteSandboxError)
  await assert.rejects(() => hub.require('c1'), RemoteSandboxError)
  assert.equal(asks, 1, 'the cached refusal must not re-ask')
  assert.equal(calls, 1)
})

test('REQ-I14: no ask when the disk artifact is already current (deploy would not help)', async () => {
  let asks = 0
  const hub = createCoreHub(ctxWith(), {
    deps: deps(CORE_ARTIFACT_VERSION),
    open: async () => {
      throw new Error('core stdout closed: jail: no bwrap on PATH')
    },
    resolveGap: async () => {
      asks += 1
      return true
    },
  })
  await assert.rejects(() => hub.require('c1'), RemoteSandboxError)
  assert.equal(asks, 0, 'a bwrap problem is not a version gap — no deploy ask')
})

test('REQ-I14: danger never asks (SFTP fallback covers it)', async () => {
  let asks = 0
  const hub = createCoreHub(ctxWith(), {
    deps: deps(null),
    open: async () => {
      throw new Error('core stdout closed: not found')
    },
    resolveGap: async () => {
      asks += 1
      return true
    },
  })
  await assert.rejects(
    () => hub.require('c1', { policy: 'danger-full-access' }),
    (error: unknown) => isCoreMissingError(error),
  )
  assert.equal(asks, 0)
})

test('CoreMissingError stays distinguishable from the fence refusal', () => {
  assert.notEqual(new CoreMissingError('x') instanceof RemoteSandboxError, true)
})
