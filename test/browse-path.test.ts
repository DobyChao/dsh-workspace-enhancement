/**
 * UX-14: typed paths, the picker split clamp, and the full connection name
 * a truncated row shows on hover.
 * @module test/browse-path
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  browsePathDraft,
  clampSplitWidth,
  connectionHoverTitle,
  readSplitWidth,
} from '../src/client/browse-path.ts'

test('UX-14: a blank path draft does not navigate', () => {
  assert.equal(browsePathDraft('local', '   '), null)
  assert.equal(browsePathDraft('remote', ''), null)
})

test('UX-14: a local draft keeps the operator spelling', () => {
  assert.equal(browsePathDraft('local', '  D:\\work\\eee  '), 'D:\\work\\eee')
  assert.equal(browsePathDraft('local', '/home/uuz'), '/home/uuz')
})

test('UX-14: a remote draft becomes a POSIX absolute path', () => {
  assert.equal(browsePathDraft('remote', 'home/uuz/eee'), '/home/uuz/eee')
  assert.equal(browsePathDraft('remote', '\\home\\uuz\\eee\\'), '/home/uuz/eee')
  assert.equal(browsePathDraft('remote', '/'), '/')
  assert.equal(browsePathDraft('remote', '///home//uuz'), '/home/uuz')
})

test('UX-14: split width clamps and ignores garbage storage', () => {
  assert.equal(clampSplitWidth(10), SPLIT_MIN)
  assert.equal(clampSplitWidth(900), SPLIT_MAX)
  assert.equal(clampSplitWidth(Number.NaN), SPLIT_DEFAULT)
  assert.equal(readSplitWidth(null), SPLIT_DEFAULT)
  assert.equal(readSplitWidth('  '), SPLIT_DEFAULT)
  assert.equal(readSplitWidth('320'), 320)
  assert.equal(readSplitWidth('nope'), SPLIT_DEFAULT)
})

test('UX-14: a truncated connection row hovers the full name and endpoint', () => {
  assert.equal(
    connectionHoverTitle({ label: 'lab', username: 'uuz', host: '127.0.0.1', port: 22 }),
    'lab\nuuz@127.0.0.1:22',
  )
  assert.equal(
    connectionHoverTitle({ label: 'uuz@127.0.0.1', username: 'uuz', host: '127.0.0.1', port: 22 }),
    'uuz@127.0.0.1:22',
  )
  assert.equal(
    connectionHoverTitle({ label: '', username: 'root', host: 'example.com', port: 2202 }),
    'root@example.com:2202',
  )
})
