/**
 * INFRA-15: `rg` is provisioned from its OFFICIAL release on demand — the cache
 * is verified, a failed fetch is actionable, and nothing is redistributed by
 * this repository. No network here: the download seam writes a locally built
 * tarball, so the whole verify→extract→cache path is real.
 *
 * @module test/core-vendor
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { packGzipTar } from '../src/gzip-tar.ts'
import {
  cachedVendor,
  ensureVendor,
  fileSha256,
  rgCacheDir,
  rgCachePath,
  vendorCachePath,
  vendorUrl,
  type VendorSource,
} from '../src/core-vendor.ts'

/**
 * Build a gzip tarball holding `pkg/rg` without spawning PATH tar (BUG-8).
 * @param root - a temp directory to write into.
 */
function buildTarball(root: string): { archive: string; sha256: string } {
  const archive = join(root, 'rg-test.tar.gz')
  writeFileSync(archive, packGzipTar({ 'pkg/rg': '#!/bin/sh\necho fake-rg\n' }))
  return { archive, sha256: fileSha256(archive) }
}

/** A test source pointing at a locally built archive. */
function sourceFor(archive: string, sha256: string): VendorSource {
  return {
    name: 'rg',
    version: 'test-1.0.0',
    arch: 'x86_64-unknown-linux-musl',
    url: 'https://example.invalid/ripgrep-test.tar.gz',
    sha256,
    member: 'pkg/rg',
  }
}

test('core-vendor: cache layout lives under $DSH_HOME/cache/dsw-core-vendor', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsw-vendor-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal(rgCacheDir(), join(home, 'cache', 'dsw-core-vendor', `rg-15.2.0-x86_64-unknown-linux-musl`))
    assert.equal(rgCachePath(), join(rgCacheDir(), 'rg'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('core-vendor: DSW_CORE_VENDOR_BASE_URL mirrors the official download prefix', () => {
  const previous = process.env.DSW_CORE_VENDOR_BASE_URL
  try {
    delete process.env.DSW_CORE_VENDOR_BASE_URL
    assert.equal(vendorUrl('https://official.example/a/b/file.tar.gz'), 'https://official.example/a/b/file.tar.gz')
    process.env.DSW_CORE_VENDOR_BASE_URL = 'https://mirror.example/ripgrep/'
    assert.equal(vendorUrl('https://official.example/a/b/file.tar.gz'), 'https://mirror.example/ripgrep/file.tar.gz')
  } finally {
    if (previous === undefined) delete process.env.DSW_CORE_VENDOR_BASE_URL
    else process.env.DSW_CORE_VENDOR_BASE_URL = previous
  }
})

test('core-vendor: a verified fetch extracts, caches and is reused', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-vendor-'))
  const home = join(root, 'home')
  const previous = process.env.DSH_HOME
  const previousOffline = process.env.DSW_CORE_VENDOR_OFFLINE
  process.env.DSH_HOME = home
  delete process.env.DSW_CORE_VENDOR_OFFLINE
  try {
    const { archive, sha256 } = buildTarball(root)
    const source = sourceFor(archive, sha256)
    const target = vendorCachePath(source)

    const fetched = ensureVendor(source, (_url, to) => {
      // The seam stands in for curl: copy the fixture into the staged path.
      writeFileSync(to, readFileSync(archive))
      return undefined
    })
    assert.equal(fetched.ok, true)
    if (!fetched.ok) return
    assert.equal(fetched.cached, false)
    assert.equal(fetched.path, target)
    assert.equal(existsSync(target), true)
    assert.equal(readFileSync(target, 'utf8'), '#!/bin/sh\necho fake-rg\n')
    assert.equal(readFileSync(`${target}.sha256`, 'utf8').trim(), fileSha256(target))

    const reused = ensureVendor(source, () => {
      throw new Error('the cache must be used without downloading again')
    })
    assert.equal(reused.ok, true)
    if (reused.ok) assert.equal(reused.cached, true)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    if (previousOffline === undefined) delete process.env.DSW_CORE_VENDOR_OFFLINE
    else process.env.DSW_CORE_VENDOR_OFFLINE = previousOffline
  }
})

test('core-vendor: a digest mismatch is refused and says where the official copy lives', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-vendor-bad-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  try {
    const { archive } = buildTarball(root)
    const source = sourceFor(archive, 'f'.repeat(64))
    const outcome = ensureVendor(source, (_url, to) => {
      writeFileSync(to, readFileSync(archive))
      return undefined
    })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.match(outcome.detail, /sha256 mismatch/)
    assert.match(outcome.detail, /https:\/\/example\.invalid\/ripgrep-test\.tar\.gz/)
    assert.match(outcome.detail, /place the extracted binary at/)
    assert.equal(existsSync(vendorCachePath(source)), false, 'a failed fetch must not populate the cache')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('core-vendor: offline mode fails closed with the official address', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-vendor-off-'))
  const previousHome = process.env.DSH_HOME
  const previousOffline = process.env.DSW_CORE_VENDOR_OFFLINE
  process.env.DSH_HOME = join(root, 'home')
  process.env.DSW_CORE_VENDOR_OFFLINE = '1'
  try {
    const { archive, sha256 } = buildTarball(root)
    const outcome = ensureVendor(sourceFor(archive, sha256), () => {
      throw new Error('offline mode must not attempt a download')
    })
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.match(outcome.detail, /DSW_CORE_VENDOR_OFFLINE/)
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    if (previousOffline === undefined) delete process.env.DSW_CORE_VENDOR_OFFLINE
    else process.env.DSW_CORE_VENDOR_OFFLINE = previousOffline
  }
})

test('core-vendor: a corrupt cache entry is ignored (digest sidecar must match)', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsw-vendor-corrupt-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  try {
    const { archive, sha256 } = buildTarball(root)
    const source = sourceFor(archive, sha256)
    const target = vendorCachePath(source)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, 'tampered')
    writeFileSync(`${target}.sha256`, `${'a'.repeat(64)}\n`)
    assert.equal(cachedVendor(source), undefined)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
