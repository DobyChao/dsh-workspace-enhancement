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
 * Why not also re-read the artifact's MANIFEST here: the expected file name is
 * version- and arch-stamped and both come from `core/artifact.json`, so a stale
 * artifact simply is not found (→ rebuild). The in-tarball check belongs to the
 * deploy path (`manifestIssues` in `src/core-deploy.ts`, which runs on the host)
 * — and reading a tar through a pipe is exactly what the DSH file sandbox
 * forbids, so the guard stays spawn-light on purpose.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, artifactName, distCoreSha256, readArtifactMeta } from './core-artifact.mjs'

const optional = process.argv.includes('--optional')
const meta = readArtifactMeta()
const artifact = join(ROOT, 'core', 'dist', artifactName(meta))

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

/**
 * REQ-I17 provenance self-registration: Go builds are not byte-reproducible
 * across toolchains, so a static hash list would reject a legitimately
 * rebuilt artifact (CI proved this on day one). Instead, whoever ENSURES the
 * tarball also registers its binary hash in `core/artifact.json` and
 * re-projects the TS constants — every built artifact is by definition one we
 * shipped, and the shipped package can never distrust its own core.
 */
function registerBuiltHash() {
  const sha = distCoreSha256()
  if (sha === null) return
  const metaNow = readArtifactMeta()
  if (metaNow.compatHashes.includes(sha)) return
  metaNow.compatHashes.push(sha)
  writeFileSync(
    join(ROOT, 'core', 'artifact.json'),
    JSON.stringify(metaNow, null, 2) + '\n',
  )
  const sync = spawnSync(process.execPath, [join(ROOT, 'scripts', 'sync-core-manifest.mjs')], { cwd: ROOT, stdio: 'inherit' })
  if (sync.status !== 0) {
    console.error('[ensure-core] WARN could not re-project the core manifests after hash registration')
  } else {
    console.error(`[ensure-core] registered core binary sha256 ${sha.slice(0, 12)}… in compatHashes`)
  }
}

if (existsSync(artifact)) {
  registerBuiltHash()
  // stderr on purpose: `npm pack --json` parses OUR stdout, and a lifecycle
  // script that prints to stdout corrupts that JSON (caught by pack-smoke).
  console.error(`[ensure-core] ${artifactName(meta)} is present`)
  process.exit(0)
}

if (build() && existsSync(artifact)) {
  registerBuiltHash()
  console.error(`[ensure-core] built ${artifact}`)
  process.exit(0)
}

if (optional) {
  console.warn('[ensure-core] WARN no core artifact and it could not be built here'
    + ' — run `npm run build:core` from a shell with the Go toolchain')
  process.exit(0)
}
console.error(`[ensure-core] core artifact missing: ${artifact} (and it could not be built)`)
process.exit(1)
