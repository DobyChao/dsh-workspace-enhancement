#!/usr/bin/env node
/**
 * Build the linux-x64 dsh-core tarball into core/dist/.
 *
 * The tarball carries ONLY the first-party core binary (ADR-0024, INFRA-15).
 * Third-party tools are never redistributed by this repository:
 *   - `bwrap` must come from the remote host's own package manager (the core
 *     resolves it next to itself and then on PATH);
 *   - `rg` is fetched from its OFFICIAL release at deploy time, verified against
 *     the pinned sha256, cached on the host and pushed beside the core
 *     (`src/core-vendor.ts`).
 * A `go build` that cannot run is still a hard failure — the previous silent
 * skip produced a tarball that could not start remotely.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactName, readArtifactMeta } from './core-artifact.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const coreDir = join(root, 'core')
const staging = join(coreDir, 'dist', 'staging')
const dist = join(coreDir, 'dist')
// Version/arch come from the single source (`core/artifact.json`) so the name
// built here always matches what `coreArtifactName()` looks for at deploy time.
const meta = readArtifactMeta()
const version = meta.version
const artifact = artifactName(meta)

rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
mkdirSync(dist, { recursive: true })

// GOTELEMETRY=off: go tries to write an upload token under the user profile
// even for a plain build, which fails under sandboxes/CI with a locked home.
const env = { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64', GOTELEMETRY: 'off' }
const built = spawnSync('go', ['build', '-o', join(staging, 'dsh-core'), '.'], {
  cwd: coreDir,
  env,
  encoding: 'utf8',
})
if (built.error !== undefined) {
  console.error(
    `go could not be spawned: ${built.error.message}. ` +
    'Under the DSH file sandbox process spawns are EPERM — run `npm run build:core` from a normal shell, or let CI build it.',
  )
  process.exit(1)
}
if (built.status !== 0) {
  console.error(built.stderr || built.stdout || 'go build failed')
  process.exit(built.status ?? 1)
}

const files = { 'dsh-core': shaOf(join(staging, 'dsh-core')) }

writeFileSync(join(staging, 'MANIFEST.json'), `${JSON.stringify({
  version,
  arch: meta.manifestArch,
  proto: 1,
  caps: ['fs', 'spawn', 'rg'],
  files,
}, null, 2)}\n`)

const tar = spawnSync('tar', ['-czf', join(dist, artifact), '-C', staging, '.'], { encoding: 'utf8' })
// The staging tree holds an UNPACKED copy of the same binary plus its MANIFEST.
// `files: ["core/dist/*.tar.gz"]` keeps it out of the npm package, and removing
// it here keeps it off disk too (2026-09-17: a `core/dist` glob shipped it).
rmSync(staging, { recursive: true, force: true })
if (tar.status !== 0) {
  console.error(tar.stderr || tar.stdout || 'tar failed')
  process.exit(tar.status ?? 1)
}
// stderr, not stdout: this runs inside `prepack` when the tarball is missing at
// pack time, and `npm pack --json` parses stdout (see scripts/ensure-core.mjs).
console.error(`wrote ${join(dist, artifact)}`)

function shaOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
