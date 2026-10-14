#!/usr/bin/env node
/**
 * Build every linux dsh-core tarball listed in core/artifact.json into core/dist/.
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
 *
 * REQ-I26: one tarball per `targets[]` row (`linux-x64`, `linux-arm64`).
 * An existing tarball is left alone unless `--force` is passed — Go builds
 * are not byte-reproducible, and rebuilding would churn compatHashes.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactNameFor, artifactTargets, distCoreSha256, readArtifactMeta } from './core-artifact.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const coreDir = join(root, 'core')
const staging = join(coreDir, 'dist', 'staging')
const dist = join(coreDir, 'dist')
const meta = readArtifactMeta()
const version = meta.version
const force = process.argv.includes('--force')
const targets = artifactTargets(meta)

mkdirSync(dist, { recursive: true })

const pending = targets.filter((target) => {
  if (force) return true
  return distCoreSha256({ version, arch: target.arch }) === null
})

if (pending.length === 0) {
  const names = targets.map((target) => artifactNameFor(version, target.arch)).join(', ')
  console.error(`[build-core] ${names} already built — pass --force to rebuild`)
  process.exit(0)
}

for (const target of pending) {
  buildTarget(target)
}
rmSync(staging, { recursive: true, force: true })

/**
 * Cross-compile one target and pack its tarball.
 * @param target - one `core/artifact.json` targets row.
 */
function buildTarget(target) {
  const artifact = artifactNameFor(version, target.arch)
  const targetStaging = join(staging, target.arch)
  rmSync(targetStaging, { recursive: true, force: true })
  mkdirSync(targetStaging, { recursive: true })

  // GOTELEMETRY=off: go tries to write an upload token under the user profile
  // even for a plain build, which fails under sandboxes/CI with a locked home.
  const env = { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: target.goarch, GOTELEMETRY: 'off' }
  const built = spawnSync('go', ['build', '-o', join(targetStaging, 'dsh-core'), '.'], {
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
    console.error(built.stderr || built.stdout || `go build failed (${target.arch})`)
    process.exit(built.status ?? 1)
  }

  const files = { 'dsh-core': shaOf(join(targetStaging, 'dsh-core')) }
  writeFileSync(join(targetStaging, 'MANIFEST.json'), `${JSON.stringify({
    version,
    arch: target.manifestArch,
    proto: 1,
    caps: ['fs', 'spawn', 'rg'],
    files,
  }, null, 2)}\n`)

  // Relative output name + cwd: an absolute Windows path carries a drive-letter
  // colon that GNU tar parses as a remote host ("Cannot connect to D:") — the
  // same trap distCoreSha256 avoids.
  const tar = spawnSync('tar', ['-czf', artifact, '-C', targetStaging, '.'], { cwd: dist, encoding: 'utf8' })
  rmSync(targetStaging, { recursive: true, force: true })
  if (tar.status !== 0) {
    console.error(tar.stderr || tar.stdout || `tar failed (${target.arch})`)
    process.exit(tar.status ?? 1)
  }
  // stderr, not stdout: this runs inside `prepack` when the tarball is missing at
  // pack time, and `npm pack --json` parses stdout (see scripts/ensure-core.mjs).
  console.error(`wrote ${join(dist, artifact)}`)
}

function shaOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
