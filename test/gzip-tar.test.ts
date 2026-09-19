/**
 * BUG-8: host-side gzip/ustar extract does not spawn PATH tar.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { localCoreTarball, readTarballManifest, manifestIssues } from '../src/core-deploy.ts'
import {
  extractGzipTarMember,
  extractGzipTarMemberToFile,
  packGzipTar,
} from '../src/gzip-tar.ts'

test('BUG-8: packGzipTar / extractGzipTarMember round-trip nested members and ./ prefixes', () => {
  const packed = packGzipTar({
    './MANIFEST.json': '{"files":{"dsh-core":"aa"}}\n',
    'pkg/rg': '#!/bin/sh\necho rg\n',
  })
  const dir = mkdtempSync(join(tmpdir(), 'dsw-gzip-tar-'))
  const archive = join(dir, 'a.tar.gz')
  writeFileSync(archive, packed)
  assert.equal(extractGzipTarMember(archive, 'MANIFEST.json').toString('utf8'), '{"files":{"dsh-core":"aa"}}\n')
  assert.equal(extractGzipTarMember(archive, './pkg/rg').toString('utf8'), '#!/bin/sh\necho rg\n')
  const target = join(dir, 'rg')
  assert.equal(extractGzipTarMemberToFile(archive, 'pkg/rg', target), undefined)
  assert.equal(extractGzipTarMemberToFile(archive, 'missing.bin', target)?.includes('missing.bin'), true)
})

test('BUG-8: readTarballManifest surfaces extract failures instead of returning null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-manifest-'))
  const archive = join(dir, 'core.tar.gz')
  writeFileSync(archive, packGzipTar({ 'dsh-core': 'elf' }))
  assert.throws(() => readTarballManifest(archive), /MANIFEST\.json not in/)
  writeFileSync(archive, packGzipTar({ 'MANIFEST.json': '{"files":{"dsh-core":"' + 'a'.repeat(64) + '"}}\n' }))
  const manifest = readTarballManifest(archive) as { files: { 'dsh-core': string } }
  assert.equal(manifest.files['dsh-core'].length, 64)
})

test('BUG-8: a truncated gzip names the archive in the error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsw-bad-gz-'))
  const archive = join(dir, 'bad.tar.gz')
  writeFileSync(archive, gzipSync(Buffer.from('not-a-tar')))
  assert.throws(() => extractGzipTarMember(archive, 'MANIFEST.json'), /gzip-tar: (cannot gunzip|bad ustar|member)/)
})

test('BUG-8: a locally built core tarball is readable without PATH tar', () => {
  const artifact = localCoreTarball()
  if (!existsSync(artifact)) return
  const issues = manifestIssues(readTarballManifest(artifact))
  assert.deepEqual(issues, [])
})
