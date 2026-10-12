/**
 * BUG-15 regression: `distCoreSha256` must never return a silent null for a
 * tarball that exists — the DSH file sandbox EPERMs piped stdout, the old
 * `-xzOf` reader swallowed that as null, the sha never registered, and the
 * package ended up distrusting the very core it packs. Absent → null (the
 * callers' legit skip); present-but-unreadable → throw (loud).
 *
 * @module test/bug-15-dist-sha
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { artifactName, distCoreSha256, readArtifactMeta } from '../scripts/core-artifact.mjs'

test('absent tarball is a null (the legit skip), not a throw', () => {
  const emptyDist = mkdtempSync(join(tmpdir(), 'dsw-bug15-empty-'))
  try {
    assert.equal(distCoreSha256(readArtifactMeta(), emptyDist), null)
  } finally {
    rmSync(emptyDist, { recursive: true, force: true })
  }
})

test('present-but-unreadable tarball throws — no silent null under any spawn failure', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dsw-bug15-junk-'))
  try {
    // Not a tarball at all: tar exits non-zero (or cannot spawn) — either way
    // the reader must refuse to answer null for a file that exists.
    writeFileSync(join(dist, artifactName(readArtifactMeta())), 'definitely not gzip')
    assert.throws(() => distCoreSha256(readArtifactMeta(), dist), /core\/dist\/dsh-core-[^:]+\.tar\.gz/)
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
})

test('a real tarball hashes the exact member bytes (missing tar asserts the loud path instead)', async () => {
  const meta = readArtifactMeta()
  const dist = mkdtempSync(join(tmpdir(), 'dsw-bug15-real-'))
  const staging = mkdtempSync(join(tmpdir(), 'dsw-bug15-stage-'))
  try {
    const payload = Buffer.from('dsh-core fixture for BUG-15 — bytes hashed from disk, never through a pipe\n')
    writeFileSync(join(staging, 'dsh-core'), payload)
    // Relative archive name + cwd: an absolute Windows archive path makes GNU
    // tar parse the drive-letter colon as a remote host ("Cannot connect to D:").
    const pack = spawnSync('tar', ['-czf', artifactName(meta), '-C', staging, './dsh-core'], { cwd: dist, stdio: 'ignore' })
    if (pack.status !== 0) {
      // No usable tar here: plant the tarball name anyway so the reader faces
      // a present-but-unextractable file — the loud path IS the contract.
      writeFileSync(join(dist, artifactName(meta)), 'no usable tar on this host')
      assert.throws(() => distCoreSha256(meta, dist), /core\/dist\/dsh-core-[^:]+\.tar\.gz/)
      return
    }
    const sha = distCoreSha256(meta, dist)
    assert.equal(sha, createHash('sha256').update(payload).digest('hex'))
  } finally {
    rmSync(dist, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
})
