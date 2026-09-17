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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, artifactName, readArtifactMeta } from './core-artifact.mjs'

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

if (existsSync(artifact)) {
  // stderr on purpose: `npm pack --json` parses OUR stdout, and a lifecycle
  // script that prints to stdout corrupts that JSON (caught by pack-smoke).
  console.error(`[ensure-core] ${artifactName(meta)} is present`)
  process.exit(0)
}

if (build() && existsSync(artifact)) {
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
