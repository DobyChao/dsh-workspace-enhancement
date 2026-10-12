#!/usr/bin/env node
/**
 * scripts/core-artifact.mjs — the one reader of `core/artifact.json`.
 *
 * INFRA-15 follow-up: the core artifact version and arch used to be written in
 * three places (`scripts/build-core.mjs`, `src/core-protocol.ts`,
 * `scripts/pack-smoke.mjs`). A drift between them ships a tarball that the
 * deploy path cannot find — the exact `core artifact missing` symptom, but on a
 * package that looks correct. The JSON is the single source; the TS side is
 * generated from it (`scripts/sync-core-version.mjs`) and `npm run check:static`
 * fails when that projection is stale.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCapture } from './lib/run.mjs'

/** Repository root (the directory holding `package.json`). */
export const ROOT = resolve(dirname(fileURLToPath(new URL('../package.json', import.meta.url))))

/** Absolute path of the single source of truth. */
export const ARTIFACT_JSON = join(ROOT, 'core', 'artifact.json')

/**
 * Read and validate the single source of truth.
 * @returns the parsed `{ version, arch, manifestArch }`.
 * @throws when the file is unreadable or a field is missing/not a string.
 */
export function readArtifactMeta() {
  const meta = JSON.parse(readFileSync(ARTIFACT_JSON, 'utf8'))
  for (const key of ['version', 'arch', 'manifestArch']) {
    if (typeof meta[key] !== 'string' || meta[key] === '') {
      throw new Error(`core/artifact.json: "${key}" must be a non-empty string`)
    }
  }
  if (!Array.isArray(meta.compatHashes) || meta.compatHashes.length === 0
    || meta.compatHashes.some(hash => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error('core/artifact.json: "compatHashes" must be a non-empty array of lowercase sha256 values (every dsh-core binary the fence may run — REQ-I17 provenance gate)')
  }
  return meta
}

/**
 * Tarball file name for one artifact meta.
 * @param meta - the validated meta.
 * @returns `dsh-core-<version>-<arch>.tar.gz`.
 */
export function artifactName(meta) {
  return `dsh-core-${meta.version}-${meta.arch}.tar.gz`
}

/**
 * sha256 of the dsh-core member inside the built dist tarball, or `null` when
 * the tarball is absent (REQ-I17 provenance gate: the fence only runs
 * registered binaries, and a built binary must be registered).
 *
 * BUG-15: the member is EXTRACTED into a scratch dir over plain file
 * descriptors and hashed from disk. The previous `-xzOf` pipe capture both
 * EPERMs under the DSH file sandbox (returning a silent null for a tarball
 * that was right there — the sha never registered, the gate skipped, and the
 * package distrusted its own core) and would have corrupted the binary had it
 * run, because stdout must never pass through utf8. A tarball that exists but
 * cannot be extracted THROWS: "absent" and "unreadable" must not share the
 * silent-null exit.
 *
 * @param meta - validated artifact meta (defaults to the file's).
 * @param distDir - dist dir override (tests; defaults to `<root>/core/dist`).
 */
export function distCoreSha256(meta = readArtifactMeta(), distDir = join(ROOT, 'core', 'dist')) {
  const name = artifactName(meta)
  if (!existsSync(join(distDir, name))) return null
  const work = mkdtempSync(join(tmpdir(), 'dsw-dist-sha-'))
  try {
    let lastStderr = ''
    for (const member of ['./dsh-core', 'dsh-core']) {
      // Relative name + cwd: an absolute Windows path carries a drive-letter
      // colon that GNU tar parses as a remote host ("Cannot connect to D:").
      const out = runCapture('tar', ['-xzf', name, '-C', work, member], { cwd: distDir })
      if (out.status === 0 && existsSync(join(work, 'dsh-core'))) {
        return createHash('sha256').update(readFileSync(join(work, 'dsh-core'))).digest('hex')
      }
      if (out.error !== undefined) {
        throw new Error(`core/dist/${name}: cannot run tar (${out.error.message}) — the provenance gate cannot verify this tarball`)
      }
      lastStderr = out.stderr.trim()
    }
    throw new Error(`core/dist/${name}: tar extracted no dsh-core member${lastStderr !== '' ? ` (${lastStderr})` : ''} — the provenance gate cannot verify this tarball`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
