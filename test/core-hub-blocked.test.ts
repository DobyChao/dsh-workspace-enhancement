/**
 * BUG-31: a missing-bubblewrap refusal must not stick for the whole CoreHub
 * session, and a still-broken remote must not open a serve per require.
 * @module test/core-hub-blocked
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
import { CORE_BLOCKED_RETRY_MS, createCoreHub } from '../src/core-hub.ts'
import type { CoreSessionOpener } from '../src/core-hub.ts'
import { CORE_ARTIFACT_VERSION, CORE_COMPAT_HASHES } from '../src/core-protocol.ts'
import { REMOTE_SANDBOX_UNAVAILABLE, RemoteSandboxError } from '../src/remote-sandbox.ts'
import { remoteSandboxUnavailable } from '../src/remote-sandbox-fence.ts'
import type { RemoteSandboxDeps, RemoteSandboxMachineFace } from '../src/remote-sandbox-fence.ts'

/** Stderr the core prints when neither bubblewrap nor Landlock can confine. */
const MISSING_BWRAP = [
  'core stdout closed: SANDBOX_UNAVAILABLE: sandbox mode "read-only" cannot be confined',
  '— bubblewrap is not installed; and the kernel does not expose Landlock.',
  'Install bubblewrap (Debian/Ubuntu `apt-get install bubblewrap`, Fedora/RHEL `dnf install bubblewrap`)',
].join(' ')

function pair(root: string, version: string = CORE_ARTIFACT_VERSION): CoreClient {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  serveFakeCore(toServer, toClient, { root, sandbox: 'read-only', version })
  return new CoreClient(toServer, toClient)
}

function deps(): RemoteSandboxDeps {
  const machine: RemoteSandboxMachineFace = { id: 'c1', workspace: '/work', cwd: '/work' }
  const connection = {
    exec: async (command: string) => {
      if (command.startsWith('sha256sum')) {
        return { exitCode: 0, signal: null, stdout: `${CORE_COMPAT_HASHES[0]}  dsh-core\n`, stderr: '' }
      }
      if (command.includes('dsh-core version')) {
        return {
          exitCode: 0,
          signal: null,
          stdout: `${JSON.stringify({ version: CORE_ARTIFACT_VERSION, arch: 'x86_64', proto: 1, caps: [] })}\n`,
          stderr: '',
        }
      }
      return { exitCode: 0, signal: null, stdout: '', stderr: '' }
    },
  }
  return {
    machine: (id) => (id === 'c1' ? machine : undefined),
    connection: (id) => (id === 'c1' ? connection as never : undefined),
    unavailable: remoteSandboxUnavailable,
  }
}

function ctxWith(): Context {
  const ctx = new Context()
  ctx.provide('sshRegistry', { get: () => undefined })
  return ctx
}

function hubWith(open: CoreSessionOpener, now: () => number) {
  return createCoreHub(ctxWith(), { deps: deps(), idleMs: 0, now, open })
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    assert.ok(error instanceof RemoteSandboxError)
    assert.equal(error.code, REMOTE_SANDBOX_UNAVAILABLE)
    return error
  }
  assert.fail('expected SANDBOX_UNAVAILABLE')
}

const readOnly = { policy: 'read-only' as const }

test('BUG-31: installing bubblewrap lets the next require in the same session open the fence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-bwrap-fix-'))
  let installed = false
  let opens = 0
  let fixed: CoreClient | undefined
  const hub = hubWith(async () => {
    opens += 1
    if (!installed) throw new Error(MISSING_BWRAP)
    fixed = pair(root)
    return fixed
  }, () => 1_000)
  const first = await refusalOf(() => hub.require('c1', readOnly))
  assert.match(first.message, /bubblewrap is not installed/)
  assert.match(first.message, /apt-get install bubblewrap/)
  assert.equal(opens, 1)

  installed = true
  const client = await hub.require('c1', readOnly)
  assert.equal(opens, 2)
  assert.equal(client, fixed)
  const again = await hub.require('c1', readOnly)
  assert.equal(again, client, 'a live serve is reused; the fix does not open a serve per call')
  assert.equal(opens, 2)
  client.close()
})

test('BUG-31: a fence fixed after the one retry was spent reopens once the window ends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-bwrap-late-'))
  let installed = false
  let opens = 0
  let now = 5_000
  const hub = hubWith(async () => {
    opens += 1
    if (!installed) throw new Error(MISSING_BWRAP)
    return pair(root)
  }, () => now)
  await refusalOf(() => hub.require('c1', readOnly))
  await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(opens, 2)
  installed = true
  await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(opens, 2, 'inside the window the cached refusal is thrown with no serve')
  now += CORE_BLOCKED_RETRY_MS
  const client = await hub.require('c1', readOnly)
  assert.equal(opens, 3)
  const again = await hub.require('c1', readOnly)
  assert.equal(again, client)
  assert.equal(opens, 3)
  client.close()
})

test('BUG-31: a persisting bubblewrap refusal does not reopen on every require', async () => {
  let opens = 0
  let now = 10_000
  const hub = hubWith(async () => {
    opens += 1
    throw new Error(MISSING_BWRAP)
  }, () => now)
  await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(opens, 1)
  const retried = await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(opens, 2, 'the require after the failure reopens once')

  for (let i = 0; i < 20; i += 1) {
    const held = await refusalOf(() => hub.require('c1', readOnly))
    assert.equal(held, retried, 'later requires throw the cached error')
  }
  assert.equal(opens, 2)

  now += CORE_BLOCKED_RETRY_MS - 1
  const stillHeld = await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(stillHeld, retried)
  assert.equal(opens, 2)

  now += 1
  const afterWindow = await refusalOf(() => hub.require('c1', readOnly))
  assert.notEqual(afterWindow, retried)
  assert.match(afterWindow.message, /bubblewrap is not installed/)
  assert.equal(opens, 3, 'the window allows one reopen, not a serve per call')

  for (let i = 0; i < 20; i += 1) {
    const held = await refusalOf(() => hub.require('c1', readOnly))
    assert.equal(held, afterWindow)
  }
  assert.equal(opens, 3)
})

test('BUG-31: a missing core stays cached past the fence retry window', async () => {
  let opens = 0
  let now = 0
  const hub = hubWith(async () => {
    opens += 1
    throw new Error('core binary missing')
  }, () => now)
  await refusalOf(() => hub.require('c1', readOnly))
  await refusalOf(() => hub.require('c1', readOnly))
  now += CORE_BLOCKED_RETRY_MS * 5
  await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(opens, 1, 'a missing binary is not a fence-environment failure')
})

test('BUG-31: a version refusal stays cached past the fence retry window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-bwrap-ver-'))
  const stale = pair(root, '0.0.1-old')
  let opens = 0
  let now = 0
  const hub = hubWith(async () => {
    opens += 1
    return stale
  }, () => now)
  const first = await refusalOf(() => hub.require('c1', readOnly))
  assert.match(first.message, /0\.0\.1-old/)
  now += CORE_BLOCKED_RETRY_MS * 5
  const second = await refusalOf(() => hub.require('c1', readOnly))
  assert.equal(second, first)
  assert.equal(opens, 1)
  stale.close()
})
