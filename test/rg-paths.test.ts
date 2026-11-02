/**
 * BUG-28: ripgrep's POSIX absolute paths must not become `D:\...` on Windows.
 * @module test/rg-paths
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { win32 } from 'node:path'
import { RgStdoutRewriter, rewriteRgLine } from '../src/rg-paths.ts'
import { sshRoutePlaceholder } from '../src/transport.ts'

test('rewriteRgLine: a bare POSIX path becomes the placeholder, and win32 relative stays inside it', () => {
  const workdir = sshRoutePlaceholder('c1', '/home/uuz')
  const fixed = rewriteRgLine('/home/uuz/.probe.txt', 'c1')
  assert.equal(win32.relative(workdir, fixed), '.probe.txt')
})

test('rewriteRgLine: a nested path stays relative to the session directory', () => {
  const workdir = sshRoutePlaceholder('c1', '/home/uuz')
  const fixed = rewriteRgLine('/home/uuz/sub/a.txt', 'c1')
  assert.equal(win32.relative(workdir, fixed), 'sub\\a.txt')
})

test('rewriteRgLine: json path fields change and match text does not', () => {
  const line = JSON.stringify({
    type: 'match',
    data: {
      path: { text: '/home/uuz/.probe.txt' },
      lines: { text: 'see /home/uuz/.probe.txt\n' },
      line_number: 1,
    },
  })
  const parsed = JSON.parse(rewriteRgLine(line, 'c1')) as { data: { path: { text: string }; lines: { text: string } } }
  assert.equal(parsed.data.lines.text, 'see /home/uuz/.probe.txt\n')
  assert.equal(win32.relative(sshRoutePlaceholder('c1', '/home/uuz'), parsed.data.path.text), '.probe.txt')
})

test('rewriteRgLine: relative names and broken json stay put', () => {
  assert.equal(rewriteRgLine('.probe.txt', 'c1'), '.probe.txt')
  assert.equal(rewriteRgLine('{not json', 'c1'), '{not json')
})

test('RgStdoutRewriter: a record split across chunks is one rewritten line', () => {
  const rewriter = new RgStdoutRewriter('c1')
  const raw = `${JSON.stringify({ type: 'begin', data: { path: { text: '/home/uuz/.probe.txt' } } })}\n`
  const mid = Math.floor(raw.length / 2)
  const parts: string[] = []
  rewriter.push(Buffer.from(raw.slice(0, mid)), bytes => { parts.push(bytes.toString('utf8')) })
  assert.equal(parts.length, 0)
  rewriter.push(Buffer.from(raw.slice(mid)), bytes => { parts.push(bytes.toString('utf8')) })
  rewriter.flush(bytes => { parts.push(bytes.toString('utf8')) })
  const parsed = JSON.parse(parts.join('').trim()) as { data: { path: { text: string } } }
  assert.equal(win32.relative(sshRoutePlaceholder('c1', '/home/uuz'), parsed.data.path.text), '.probe.txt')
})
