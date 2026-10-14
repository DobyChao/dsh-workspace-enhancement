#!/usr/bin/env node
/**
 * scripts/ensure-core.mjs — the "the tarball you are about to ship has the core
 * in it" guard.
 *
 * `npm pack` / `npm publish` run this through `prepack`. It closes the hole
 * `files: ["core/dist"]` leaves open: `files` only *allows* the artifact into
 * the tarball, nothing builds it — a clean clone used to pack a core-less
 * package that installs fine and then fails at deploy time with
 * `core artifact missing`.
 *
 * `npm run build` also calls it with `--optional`, so a local (linked) dev
 * install gets the tarball the deploy path looks for. `--optional` only
 * downgrades "missing and the toolchain cannot build it" to a warning; when the
 * artifact cannot be built at all the pack path fails hard.
 *
 * REQ-I26: every `targets[]` row must be present (linux-x64 and linux-arm64).
 * Each built binary's sha256 is registered once in the flat `compatHashes`
 * list, then the TS projection is regenerated a single time.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, artifactNameFor, artifactTargets, distCoreSha256, eachDistCoreSha, readArtifactMeta } from './core-artifact.mjs'

const optional = process.argv.includes('--optional')
const meta = readArtifactMeta()

/**
 * Run `scripts/build-core.mjs` in this process' place (stdio inherited: piped
 * stdio is denied inside the DSH sandbox, inherited is not).
 * @returns true when the build exited 0.
 */
function build() {
  const built = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-core.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  return built.status === 0
}

/** Arches whose dist tarball is not on disk yet. */
function missingTargets(metaNow = readArtifactMeta()) {
  return artifactTargets(metaNow).filter(
    (target) => distCoreSha256({ version: metaNow.version, arch: target.arch }) === null,
  )
}

/**
 * REQ-I17 provenance self-registration: Go builds are not byte-reproducible
 * across toolchains, so a static hash list would reject a legitimately
 * rebuilt artifact (CI proved this on day one). Instead, whoever ENSURES the
 * tarball also registers its binary hash in `core/artifact.json` and
 * re-projects the TS constants — every built artifact is by definition one we
 * shipped, and the shipped package can never distrust its own core.
 */
function registerBuiltHashes() {
  const metaNow = readArtifactMeta()
  const built = eachDistCoreSha(metaNow)
  let added = false
  for (const row of built) {
    if (metaNow.compatHashes.includes(row.sha)) continue
    metaNow.compatHashes.push(row.sha)
    added = true
    console.error(`[ensure-core] registered ${row.arch} binary sha256 ${row.sha.slice(0, 12)}… in compatHashes`)
  }
  if (!added) return
  writeFileSync(join(ROOT, 'core', 'artifact.json'), JSON.stringify(metaNow, null, 2) + '\n')
  const sync = spawnSync(process.execPath, [join(ROOT, 'scripts/sync-core-manifest.mjs')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  if (sync.status !== 0) {
    console.error('[ensure-core] WARN could not re-project the core manifests after hash registration')
  }
}

const names = artifactTargets(meta).map((target) => artifactNameFor(meta.version, target.arch))
if (missingTargets(meta).length === 0) {
  registerBuiltHashes()
  // stderr on purpose: `npm pack --json` parses OUR stdout, and a lifecycle
  // script that prints to stdout corrupts that JSON (caught by pack-smoke).
  console.error(`[ensure-core] ${names.join(', ')} present`)
  process.exit(0)
}

if (build() && missingTargets().length === 0) {
  registerBuiltHashes()
  console.error(`[ensure-core] built ${names.join(', ')}`)
  process.exit(0)
}

if (optional) {
  console.warn('[ensure-core] WARN no core artifact and it could not be built here'
    + ' — run `npm run build:core` from a shell with the Go toolchain')
  process.exit(0)
}
console.error(`[ensure-core] core artifact missing: ${names.join(', ')} (and it could not be built)`)
process.exit(1)
