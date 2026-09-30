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
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
 * the tarball is absent or unreadable (REQ-I17 provenance gate: the fence only
 * runs registered binaries, and a built binary must be registered).
 * @param meta - validated artifact meta (defaults to the file's).
 */
export function distCoreSha256(meta = readArtifactMeta()) {
  const name = artifactName(meta)
  const dir = join(ROOT, 'core', 'dist')
  if (!existsSync(join(dir, name))) return null
  // Relative name + cwd: an absolute Windows path carries a drive-letter
  // colon that GNU tar parses as a remote host ("Cannot connect to D:").
  for (const member of ['./dsh-core', 'dsh-core']) {
    const out = spawnSync('tar', ['-xzOf', name, member], { cwd: dir, maxBuffer: 64 * 1024 * 1024 })
    if (out.status === 0 && out.stdout.length > 0) {
      return createHash('sha256').update(out.stdout).digest('hex')
    }
  }
  return null
}
