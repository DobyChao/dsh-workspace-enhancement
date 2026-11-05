/**
 * UPSTREAM-14: hunk application must match `@deepseek-ai/dsh-fs-patch` `applyHunks`.
 * The package is not a peer (it does not exist before 0.2.2). When a drift job
 * installs it, the corpus is compared against the real function.
 * @module test/fs-patch
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyHunks } from '../src/fs-patch.ts'
import type { PatchHunk } from '../src/fs-patch.ts'

function hunk(partial: Partial<PatchHunk> & Pick<PatchHunk, 'oldLines' | 'newLines'>): PatchHunk {
  return {
    lineNumber: partial.lineNumber ?? 1,
    isEndOfFile: partial.isEndOfFile ?? false,
    oldLines: partial.oldLines,
    newLines: partial.newLines,
    ...(partial.context !== undefined ? { context: partial.context } : {}),
  }
}

const CORPUS: { name: string; before: string; hunks: PatchHunk[] }[] = [
  {
    name: 'replace one line and keep a trailing LF',
    before: 'alpha\nbeta\n',
    hunks: [hunk({ oldLines: ['beta'], newLines: ['gamma'] })],
  },
  {
    name: 'unterminated input still ends in LF',
    before: 'alpha\nbeta',
    hunks: [hunk({ oldLines: ['beta'], newLines: ['gamma'] })],
  },
  {
    name: 'context anchor then the following line',
    before: 'alpha\nbeta\ngamma\n',
    hunks: [hunk({ context: 'alpha', oldLines: ['beta'], newLines: ['BETA'] })],
  },
  {
    name: 'missing context fails closed',
    before: 'alpha\nbeta\n',
    hunks: [hunk({ context: 'missing', oldLines: ['beta'], newLines: ['BETA'] })],
  },
  {
    name: 'whitespace-insensitive old line',
    before: 'alpha\nbeta  \n',
    hunks: [hunk({ oldLines: ['beta'], newLines: ['BETA'] })],
  },
  {
    name: 'punctuation fold',
    before: 'alpha\nbeta\u2013gamma\n',
    hunks: [hunk({ oldLines: ['beta-gamma'], newLines: ['BETA'] })],
  },
  {
    name: 'EOF search uses the tail only',
    before: 'keep\nbeta\nbeta\n',
    hunks: [hunk({ oldLines: ['beta'], newLines: ['TAIL'], isEndOfFile: true })],
  },
  {
    name: 'empty old lines append',
    before: 'alpha\n',
    hunks: [hunk({ oldLines: [], newLines: ['omega'] })],
  },
  {
    name: 'trailing empty old line is retried without the sentinel',
    before: 'alpha\nbeta\n',
    hunks: [hunk({ oldLines: ['beta', ''], newLines: ['BETA', ''] })],
  },
  {
    name: 'unmatched hunk reports oldLines and keeps the original pattern',
    before: 'alpha\n',
    hunks: [hunk({ lineNumber: 4, oldLines: ['nope'], newLines: ['x'] })],
  },
]

test('applyHunks: representative hunks', () => {
  const replaced = applyHunks('alpha\nbeta\n', [hunk({ oldLines: ['beta'], newLines: ['gamma'] })])
  assert.deepEqual(replaced, { ok: true, after: 'alpha\ngamma\n' })

  const missed = applyHunks('alpha\n', [hunk({ lineNumber: 4, oldLines: ['nope'], newLines: ['x'] })])
  assert.equal(missed.ok, false)
  if (!missed.ok) {
    assert.equal(missed.failure.stage, 'oldLines')
    assert.equal(missed.failure.hunkLineNumber, 4)
    assert.deepEqual(missed.failure.pattern, ['nope'])
  }
})

test('applyHunks matches dsh-fs-patch when that package is installed', async () => {
  const specifier = '@deepseek-ai/' + 'dsh-fs-patch'
  let upstream: ((before: string, hunks: readonly PatchHunk[]) => { ok: boolean }) | undefined
  try {
    const mod = await import(specifier) as { applyHunks: typeof applyHunks }
    upstream = mod.applyHunks
  } catch {
    return
  }
  for (const sample of CORPUS) {
    assert.deepEqual(applyHunks(sample.before, sample.hunks), upstream(sample.before, sample.hunks), sample.name)
  }
})
