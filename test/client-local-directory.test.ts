/**
 * BUG-3 regression: the local pane of the directory flow must resolve the
 * client `uiWorkspace` service, not `workspaces`.
 *
 * Wiring the seats to `ctx.workspaces` made every local browse fail with
 * `ctx.workspaces.listDirectory is not a function` (the `workspaces` service is
 * the Workspace Controller face and carries no directory methods). These tests
 * pin three properties the fix depends on:
 *
 *  1. both seats forward to `uiWorkspace` with their arguments intact;
 *  2. a missing service — or a service that lost the method — rejects with the
 *     localized message, never a raw TypeError;
 *  3. resolution is lazy per call, so a runtime tier that mounts the service
 *     after the bundle still gets a working pane.
 *
 * A source guard closes the exact regression: no client module may call
 * `workspaces.listDirectory` / `workspaces.createDirectory` again.
 *
 * @module test/client-local-directory
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createLocalDirectorySeats } from '../src/client/local-directory.ts'
import type { ClientUiWorkspace } from '../src/client/local-directory.ts'
import type { WireListing } from '../src/client/index.ts'
import { lookup } from '../src/locale/index.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const UNAVAILABLE = lookup('en', 'flow.error.directoryUnavailable')

/** A minimal listing stand-in (the pane only stores what the service returns). */
function listing(path: string): WireListing {
  return { path, home: '/home/u', crumbs: [], entries: [], truncated: false }
}

/** A `uiWorkspace` stand-in recording every call it receives. */
function fakeService(): {
  service: ClientUiWorkspace
  calls: { list: [string | undefined, AbortSignal | undefined][]; created: [string, string][] }
} {
  const calls: { list: [string | undefined, AbortSignal | undefined][]; created: [string, string][] } = { list: [], created: [] }
  const service: ClientUiWorkspace = {
    listDirectory: (path, signal) => {
      calls.list.push([path, signal])
      return Promise.resolve(listing(path ?? '/home/u'))
    },
    createDirectory: (path, name) => {
      calls.created.push([path, name])
      return Promise.resolve(`${path}/${name}`)
    },
  }
  return { service, calls }
}

test('listLocalDirectory forwards path and signal to uiWorkspace.listDirectory', async () => {
  const { service, calls } = fakeService()
  const seats = createLocalDirectorySeats(() => service, () => UNAVAILABLE)
  const controller = new AbortController()

  const result = await seats.listLocalDirectory('/srv/work', controller.signal)

  assert.equal(result.path, '/srv/work')
  assert.equal(calls.list.length, 1)
  assert.deepEqual(calls.list[0], ['/srv/work', controller.signal])
})

test('listLocalDirectory keeps an absent path as undefined (service picks the home)', async () => {
  const { service, calls } = fakeService()
  const seats = createLocalDirectorySeats(() => service, () => UNAVAILABLE)

  await seats.listLocalDirectory()

  assert.equal(calls.list.length, 1)
  assert.equal(calls.list[0]?.[0], undefined)
})

test('createLocalDirectory forwards path and name to uiWorkspace.createDirectory', async () => {
  const { service, calls } = fakeService()
  const seats = createLocalDirectorySeats(() => service, () => UNAVAILABLE)

  assert.equal(await seats.createLocalDirectory('/srv/work', 'logs'), '/srv/work/logs')
  assert.deepEqual(calls.created, [['/srv/work', 'logs']])
})

test('a missing uiWorkspace rejects with the localized message, not a TypeError', async () => {
  const seats = createLocalDirectorySeats(() => undefined, () => UNAVAILABLE)

  await assert.rejects(() => seats.listLocalDirectory('/srv/work'), { message: UNAVAILABLE })
  await assert.rejects(() => seats.createLocalDirectory('/srv/work', 'logs'), { message: UNAVAILABLE })
  assert.doesNotMatch(UNAVAILABLE, /is not a function/)
})

test('a service that lost the directory method is reported, not invoked blindly', async () => {
  // The BUG-3 failure shape: the service exists, the method does not.
  const drifted = { createDirectory: () => Promise.resolve('x') } as unknown as ClientUiWorkspace
  const seats = createLocalDirectorySeats(() => drifted, () => UNAVAILABLE)

  await assert.rejects(() => seats.listLocalDirectory('/srv/work'), { message: UNAVAILABLE })
})

test('the service is resolved per call, so a late-mounted runtime still works', async () => {
  const { service, calls } = fakeService()
  let mounted: ClientUiWorkspace | undefined
  const seats = createLocalDirectorySeats(() => mounted, () => UNAVAILABLE)

  await assert.rejects(() => seats.listLocalDirectory('/srv/work'), { message: UNAVAILABLE })
  mounted = service
  assert.equal((await seats.listLocalDirectory('/srv/work')).path, '/srv/work')
  assert.equal(calls.list.length, 1)
})

test('no client module calls the directory methods on the workspaces service again', () => {
  const dir = join(REPO, 'src', 'client')
  const offenders: string[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    const source = readFileSync(join(dir, name), 'utf-8')
    for (const method of ['listDirectory', 'createDirectory']) {
      const pattern = new RegExp(`workspaces\\s*\\.\\s*${method}\\s*\\(`)
      if (pattern.test(source)) offenders.push(`${name}: workspaces.${method}(`)
    }
  }
  assert.deepEqual(offenders, [], `wire directory seats to uiWorkspace (see src/client/local-directory.ts): ${offenders.join(', ')}`)
})

test('the client entry acquires the uiWorkspace service through the optional lookup', () => {
  const entry = readFileSync(join(REPO, 'src', 'client', 'index.ts'), 'utf-8')
  assert.match(entry, /createLocalDirectorySeats\(/)
  assert.match(entry, /ctx\.get\('uiWorkspace'\)/)
})
