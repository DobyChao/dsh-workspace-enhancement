/**
 * BUG-7: SFTP and the core share one FsVersion algorithm.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { fileContentVersion, statsVersionMtimeMs, versionMtimeMs } from '../src/fs-version.ts'

test('BUG-7: versionMtimeMs quantizes to whole seconds so SFTP and core agree', () => {
  assert.equal(versionMtimeMs(1_725_000_000_123), 1_725_000_000_000)
  assert.equal(versionMtimeMs(1_725_000_000_000), 1_725_000_000_000)
  assert.equal(statsVersionMtimeMs({ mtime: 1_725_000_000 }), 1_725_000_000_000)
  assert.equal(statsVersionMtimeMs({ mtimeMs: 1_725_000_000_456 }), 1_725_000_000_000)
})

test('BUG-7: fileContentVersion is sha256 of [posixPath, size, quantized mtimeMs]', () => {
  const path = '/home/u/proj/a.txt'
  const size = 12
  const mtimeMs = 1_725_000_000_123
  const token = fileContentVersion(path, size, mtimeMs)
  const want = createHash('sha256')
    .update(JSON.stringify([path, size, 1_725_000_000_000]))
    .digest('hex')
  assert.equal(token, want)
  assert.equal(fileContentVersion(path.replaceAll('/', '\\'), size, mtimeMs), token)
  assert.notEqual(fileContentVersion(path, size + 1, mtimeMs), token)
})

test('BUG-7: a Windows-slash path matches the POSIX spelling', () => {
  assert.equal(
    fileContentVersion('\\home\\u\\a.txt', 1, 1000),
    fileContentVersion('/home/u/a.txt', 1, 1000),
  )
})
