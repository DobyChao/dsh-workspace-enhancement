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
import { readFileSync } from 'node:fs'
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
