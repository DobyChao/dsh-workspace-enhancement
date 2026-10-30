#!/usr/bin/env node
/**
 * scripts/inherit-published-core-hashes.mjs — keep official core binaries trusted.
 *
 * Go builds are not byte-reproducible. Each npm release's CI binary has a
 * sha256 that lives in that published package and nowhere else. The next
 * plugin's git tree does not contain it, so an already-installed official
 * core fails the provenance gate and every machine looks like it needs
 * another deploy.
 *
 * This reads every already-published version of this package, collects the
 * compat list it shipped plus the sha256 of each `dsh-core` member in its
 * `core/dist` tarballs, and merges the new hashes into `core/artifact.json`.
 * A hash that no official release ever shipped stays off the list.
 *
 * The release workflow runs this before `npm run check`. A normal check does
 * not: it has no business talking to the registry. `--check` exits 1 when the
 * registry knows a hash the local list lacks, and does not write.
 *
 * @module scripts/inherit-published-core-hashes
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, readArtifactMeta } from './core-artifact.mjs'
import { runCapture } from './lib/run.mjs'

const CHECK = process.argv.includes('--check')

/**
 * Hashes declared by a published `lib/core-artifact.js`. Releases from before
 * the compat list existed return an empty array.
 * @param {string} source
 * @returns {string[]}
 */
export function hashesFromArtifactModule(source) {
  const block = /CORE_COMPAT_HASHES\s*=\s*\[([\s\S]*?)\]/.exec(source)
  if (block === null) return []
  return [...block[1].matchAll(/[0-9a-f]{64}/g)].map(match => match[0])
}

/**
 * @param {string[]} current
 * @param {string[]} incoming
 * @returns {string[]} hashes in `incoming` that `current` does not have, in order.
 */
export function hashesToAdd(current, incoming) {
  const seen = new Set(current)
  const added = []
  for (const hash of incoming) {
    if (!/^[0-9a-f]{64}$/.test(hash)) continue
    if (seen.has(hash)) continue
    seen.add(hash)
    added.push(hash)
  }
  return added
}

/**
 * sha256 of the `dsh-core` member of one core tarball, or `null` when the
 * member is absent. A tarball that exists but cannot be read throws.
 * @param {string} tarball
 * @returns {string | null}
 */
function binaryHashOfTarball(tarball) {
  const work = mkdtempSync(join(tmpdir(), 'dsw-inherit-sha-'))
  const dir = dirname(tarball)
  const name = basename(tarball)
  try {
    for (const member of ['./dsh-core', 'dsh-core']) {
      const out = runCapture('tar', ['-xzf', name, '-C', work, member], { cwd: dir })
      const file = join(work, 'dsh-core')
      if (out.status === 0 && existsSync(file)) {
        return createHash('sha256').update(readFileSync(file)).digest('hex')
      }
      if (out.error !== undefined) {
        throw new Error(`${name}: cannot run tar (${out.error.message})`)
      }
    }
    return null
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Official hashes carried by one extracted npm package directory.
 * @param {string} packageDir
 * @returns {string[]}
 */
export function hashesFromPackedPackage(packageDir) {
  const found = []
  const modulePath = join(packageDir, 'lib', 'core-artifact.js')
  if (existsSync(modulePath)) found.push(...hashesFromArtifactModule(readFileSync(modulePath, 'utf8')))
  const dist = join(packageDir, 'core', 'dist')
  if (existsSync(dist)) {
    for (const name of readdirSync(dist)) {
      if (!name.endsWith('.tar.gz')) continue
      const sha = binaryHashOfTarball(join(dist, name))
      if (sha !== null) found.push(sha)
    }
  }
  return found
}

/**
 * Places `npm-cli.js` might live next to a node binary.
 * Windows installs it beside `node.exe`. Official tarballs and
 * actions/setup-node put it in `../lib/node_modules`.
 * @param {string} execPath
 * @returns {string[]}
 */
export function npmCliCandidates(execPath) {
  const bin = dirname(execPath)
  return [
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
}

/**
 * `npm.cmd` cannot be spawned on Windows (EINVAL). Run `npm-cli.js` with
 * node. A Unix `npm` on PATH is the last resort, for a layout we did not guess.
 * @param {string[]} args
 * @returns {{ status: number | null, error?: Error, stdout: string, stderr: string }}
 */
function npmRun(args) {
  const fromEnv = process.env.npm_execpath
  const candidates = [
    ...(fromEnv !== undefined && fromEnv !== '' ? [fromEnv] : []),
    ...npmCliCandidates(process.execPath),
  ]
  const cli = candidates.find(path => existsSync(path))
  if (cli !== undefined) {
    return runCapture(process.execPath, [cli, ...args], { cwd: ROOT, timeoutMs: 120_000 })
  }
  if (process.platform !== 'win32') {
    return runCapture('npm', args, { cwd: ROOT, timeoutMs: 120_000 })
  }
  return {
    status: null,
    error: new Error('npm CLI not found (npm_execpath unset and npm-cli.js not beside node)'),
    stdout: '',
    stderr: '',
  }
}

/**
 * @param {{ status: number | null, error?: Error, stdout: string, stderr: string }} out
 * @returns {string}
 */
function captureFailure(out) {
  return out.error?.message || out.stderr.trim() || out.stdout.trim() || `exit ${out.status}`
}

/** @returns {string[]} */
function publishedVersions() {
  const name = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  const out = npmRun(['view', name, 'versions', '--json'])
  if (out.status !== 0) {
    throw new Error(`npm view ${name} versions failed: ${captureFailure(out)}`)
  }
  const parsed = JSON.parse(out.stdout)
  const versions = Array.isArray(parsed) ? parsed : [parsed]
  return versions.filter(version => typeof version === 'string')
}

/**
 * @param {string} version
 * @param {string} dest
 * @returns {string} extracted `package/` directory
 */
function packVersion(version, dest) {
  const name = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  const out = npmRun(['pack', `${name}@${version}`, '--json', '--pack-destination', dest])
  if (out.status !== 0) {
    throw new Error(`npm pack ${name}@${version} failed: ${captureFailure(out)}`)
  }
  const rows = JSON.parse(out.stdout)
  const filename = rows?.[0]?.filename
  if (typeof filename !== 'string' || filename === '') {
    throw new Error(`npm pack ${name}@${version} returned no filename`)
  }
  const extract = runCapture('tar', ['-xzf', filename, '-C', dest], { cwd: dest })
  if (extract.status !== 0) {
    throw new Error(`cannot extract ${filename}: ${extract.stderr.trim()}`)
  }
  const packageDir = join(dest, 'package')
  if (!existsSync(packageDir)) throw new Error(`${filename} has no package/ directory`)
  return packageDir
}

function main() {
  const meta = readArtifactMeta()
  const incoming = []
  for (const version of publishedVersions()) {
    const dest = mkdtempSync(join(tmpdir(), 'dsw-inherit-pack-'))
    try {
      const packageDir = packVersion(version, dest)
      const hashes = hashesFromPackedPackage(packageDir)
      console.error(`[inherit-core-hashes] ${version}: ${hashes.length} official hash(es)`)
      incoming.push(...hashes)
    } finally {
      rmSync(dest, { recursive: true, force: true })
    }
  }
  const added = hashesToAdd(meta.compatHashes, incoming)
  if (added.length === 0) {
    console.error('[inherit-core-hashes] compatHashes already contains every published official hash')
    return
  }
  if (CHECK) {
    console.error(`[inherit-core-hashes] ${added.length} published hash(es) are missing from compatHashes`)
    for (const hash of added) console.error(`  ${hash}`)
    process.exitCode = 1
    return
  }
  meta.compatHashes.push(...added)
  writeFileSync(join(ROOT, 'core', 'artifact.json'), `${JSON.stringify(meta, null, 2)}\n`)
  const sync = runCapture(process.execPath, ['scripts/sync-core-manifest.mjs'], { cwd: ROOT })
  if (sync.status !== 0) {
    throw new Error(`sync-core-manifest failed: ${sync.stderr.trim()}`)
  }
  console.error(`[inherit-core-hashes] added ${added.length} hash(es)`)
}

const invoked = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) main()
