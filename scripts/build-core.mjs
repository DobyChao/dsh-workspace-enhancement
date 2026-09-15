#!/usr/bin/env node
/**
 * Build the linux-x64 dsh-core tarball into core/dist/.
 * Bundled bwrap/rg are copied from core/vendor/ when present; the tarball is
 * still produced without them (jail then fails closed until those files exist).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const coreDir = join(root, 'core')
const staging = join(coreDir, 'dist', 'staging')
const dist = join(coreDir, 'dist')
const version = '0.2.0-dev'
const artifact = `dsh-core-${version}-linux-x64.tar.gz`

rmSync(staging, { recursive: true, force: true })
mkdirSync(join(staging, 'bin'), { recursive: true })
mkdirSync(dist, { recursive: true })

const env = { ...process.env, CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' }
const built = spawnSync('go', ['build', '-o', join(staging, 'dsh-core'), '.'], {
  cwd: coreDir,
  env,
  encoding: 'utf8',
})
if (built.status !== 0) {
  console.error(built.stderr || built.stdout || 'go build failed')
  process.exit(built.status ?? 1)
}

const vendor = join(coreDir, 'vendor')
const files = { 'dsh-core': shaOf(join(staging, 'dsh-core')) }
for (const name of ['bwrap', 'rg']) {
  const source = join(vendor, name)
  if (existsSync(source)) {
    copyFileSync(source, join(staging, 'bin', name))
    files[`bin/${name}`] = shaOf(join(staging, 'bin', name))
  }
}

writeFileSync(join(staging, 'MANIFEST.json'), `${JSON.stringify({
  version,
  arch: 'linux-x86_64',
  proto: 1,
  caps: ['fs', 'spawn', 'rg'],
  files,
}, null, 2)}\n`)

const tar = spawnSync('tar', ['-czf', join(dist, artifact), '-C', staging, '.'], { encoding: 'utf8' })
if (tar.status !== 0) {
  console.error(tar.stderr || tar.stdout || 'tar failed')
  process.exit(tar.status ?? 1)
}
console.log(`wrote ${join(dist, artifact)}`)

function shaOf(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
