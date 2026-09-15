/**
 * REQ-I5 / ADR-0024: framed protocol codec + fake-core round-trip.
 * No SSH. Production cutover is a later slice.
 * @module test/core-protocol
 */

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { CoreClient, CoreRpcError } from '../src/core-client.ts'
import { serveFakeCore } from '../src/core-fake.ts'
import {
  CORE_ARTIFACT_VERSION,
  CORE_CAPS,
  CORE_ERROR_IO,
  CORE_ERROR_READ_ONLY,
  CORE_ERROR_UNIMPLEMENTED,
  CORE_MAX_FRAME,
  CORE_METHODS,
  CORE_PROTO,
  decodeFrames,
  encodeFrame,
  methodAllowed,
} from '../src/core-protocol.ts'

test('encodeFrame / decodeFrames: round-trip one hello request', () => {
  const frame = encodeFrame({ id: 1, m: CORE_METHODS.hello, p: {} })
  assert.equal(frame.readUInt32BE(0), frame.length - 4)
  const { messages, rest } = decodeFrames(frame)
  assert.equal(rest.length, 0)
  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.proto, CORE_PROTO)
  assert.equal(messages[0]?.id, 1)
  assert.equal(messages[0]?.m, 'hello')
})

test('golden hello request JSON matches the Go codec (ADR-0024)', () => {
  const frame = encodeFrame({ id: 1, m: CORE_METHODS.hello, p: {} })
  assert.equal(frame.subarray(4).toString('utf8'), '{"proto":1,"id":1,"m":"hello","p":{}}')
})

test('decodeFrames: splits concatenated frames and keeps a partial tail', () => {
  const a = encodeFrame({ id: 1, m: 'hello' })
  const b = encodeFrame({ id: 2, ok: { n: 7 } })
  const joined = Buffer.concat([a, b.subarray(0, 6)])
  const first = decodeFrames(joined)
  assert.equal(first.messages.length, 1)
  assert.equal(first.messages[0]?.id, 1)
  assert.ok(first.rest.length > 0)
  const second = decodeFrames(Buffer.concat([first.rest, b.subarray(6)]))
  assert.equal(second.messages.length, 1)
  assert.equal(second.messages[0]?.id, 2)
  assert.deepEqual(second.messages[0]?.ok, { n: 7 })
})

test('decodeFrames: extra JSON keys are ignored (forward compatible)', () => {
  const json = Buffer.from(JSON.stringify({ proto: 1, id: 3, m: 'hello', extra: { future: true } }), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(json.length)
  const { messages } = decodeFrames(Buffer.concat([header, json]))
  assert.equal(messages[0]?.m, 'hello')
  assert.equal(messages[0]?.id, 3)
})

test('encodeFrame: oversized payload throws rather than sending a truncated frame', () => {
  const huge = 'x'.repeat(CORE_MAX_FRAME + 1)
  assert.throws(() => encodeFrame({ id: 1, ok: huge }), /exceeds/)
})

test('methodAllowed: hello is free; fs/spawn follow caps', () => {
  assert.equal(methodAllowed('hello', []), true)
  assert.equal(methodAllowed('fs.stat', ['fs']), true)
  assert.equal(methodAllowed('fs.stat', ['spawn']), false)
  assert.equal(methodAllowed('spawn.start', ['spawn']), true)
  assert.equal(methodAllowed('pty.start', ['fs', 'spawn']), false)
})

function pair(root: string, sandbox: 'read-only' | 'workspace-write' = 'read-only', workspace?: string): CoreClient {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  serveFakeCore(toServer, toClient, { root, sandbox, ...(workspace !== undefined ? { workspace } : {}) })
  return new CoreClient(toServer, toClient)
}

test('fake core: hello advertises proto, version, and v1 caps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  const client = pair(root)
  const hello = await client.hello()
  assert.equal(hello.proto, CORE_PROTO)
  assert.equal(hello.version, CORE_ARTIFACT_VERSION)
  assert.deepEqual([...hello.caps], [...CORE_CAPS])
  const cached = await client.hello()
  assert.equal(cached, hello)
  const live = await client.hello(undefined, { cached: false })
  assert.notEqual(live, hello)
  assert.equal(live.version, hello.version)
  client.close()
})

test('fake core: unknown method is UNIMPLEMENTED, not a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  const client = pair(root)
  await assert.rejects(
    () => client.call('pty.start', {}),
    (error: unknown) => error instanceof CoreRpcError && error.code === CORE_ERROR_UNIMPLEMENTED,
  )
  client.close()
})

test('fake core: read-only refuses writes (I9-1 dual for fs)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  mkdirSync(join(root, 'etc'), { recursive: true })
  writeFileSync(join(root, 'etc', 'hostname'), 'box\n')
  const client = pair(root, 'read-only')
  const hostname = await client.call('fs.read', { path: '/etc/hostname' }) as { b64: string }
  assert.equal(Buffer.from(hostname.b64, 'base64').toString('utf8'), 'box\n')
  await assert.rejects(
    () => client.call('fs.write', { path: '/tmp/x', b64: Buffer.from('hi').toString('base64') }),
    (error: unknown) => error instanceof CoreRpcError && error.code === CORE_ERROR_READ_ONLY,
  )
  client.close()
})

test('fake core: fs.realpath joins a missing leaf onto an existing parent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  mkdirSync(join(root, 'work'), { recursive: true })
  const client = pair(root, 'workspace-write', '/work')
  const got = await client.call('fs.realpath', { path: '/work/new.txt' }) as { path: string }
  assert.equal(got.path, '/work/new.txt')
  client.close()
})

test('fake core: workspace-write allows the bound root and refuses outside it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  mkdirSync(join(root, 'work'), { recursive: true })
  const client = pair(root, 'workspace-write', '/work')
  const ok = await client.call('fs.write', {
    path: '/work/a.txt',
    b64: Buffer.from('hello').toString('base64'),
  }) as { type: string }
  assert.equal(ok.type, 'file')
  await assert.rejects(
    () => client.call('fs.write', { path: '/etc/passwd', b64: Buffer.from('x').toString('base64') }),
    (error: unknown) => error instanceof CoreRpcError && error.code === CORE_ERROR_READ_ONLY,
  )
  client.close()
})

test('fake core: spawn.start emits stdout then exit events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-core-'))
  const client = pair(root)
  const events: Array<{ m: string; p: unknown }> = []
  client.onEvent((m, p) => { events.push({ m, p }) })
  const started = await client.call('spawn.start', { argv: ['echo', 'hi'], cwd: '/' }) as { job: string }
  assert.equal(typeof started.job, 'string')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(events.some(event => event.m === 'spawn.exit'), true)
  client.close()
})

test('CoreClient: stdout end includes a stderr suffix', async () => {
  const toServer = new PassThrough()
  const toClient = new PassThrough()
  const client = new CoreClient(toServer, toClient, {
    stderrOf: () => 'dsh-core: jail: workspace-write needs an absolute --workspace\n',
  })
  const pending = client.hello()
  toClient.end()
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof CoreRpcError
      && error.code === CORE_ERROR_IO
      && error.message.includes('workspace-write needs an absolute --workspace'),
  )
})
