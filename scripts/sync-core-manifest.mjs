#!/usr/bin/env node
/**
 * scripts/sync-core-manifest.mjs — project the core manifests into TypeScript.
 *
 * Sources of truth (edited by hand, validated here):
 *   - `core/artifact.json` — first-party core tarball version/arch.
 *   - `core/vendor.json`   — third-party tool pins (official URL + sha256) and
 *     the bwrap redistribution policy (remote-only, with install hints).
 *
 * TypeScript cannot read those JSON files at build time in this repo
 * (`rootDir: src`, no `resolveJsonModule`), so this script generates the
 * constant modules and `npm run check:static` fails when they are stale — the
 * same "generated file + staleness gate" shape `docs/status.md` already uses.
 *
 * Usage: `npm run sync:core-manifest` rewrites the files, or
 *        `node scripts/sync-core-manifest.mjs --check` verifies them.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, readArtifactMeta } from './core-artifact.mjs'

const ARTIFACT_OUT = join(ROOT, 'src', 'core-artifact.ts')
const VENDOR_OUT = join(ROOT, 'src', 'core-vendor-pins.ts')

/** Read and validate `core/vendor.json`. */
function readVendorMeta() {
  const meta = JSON.parse(readFileSync(join(ROOT, 'core', 'vendor.json'), 'utf8'))
  const strings = ['version', 'arch', 'url', 'checksumUrl', 'sha256', 'member', 'license', 'homepage']
  for (const key of strings) {
    if (typeof meta.rg?.[key] !== 'string' || meta.rg[key] === '') {
      throw new Error(`core/vendor.json: "rg.${key}" must be a non-empty string`)
    }
  }
  if (!/^[0-9a-f]{64}$/.test(meta.rg.sha256)) {
    throw new Error('core/vendor.json: "rg.sha256" must be a lowercase sha256')
  }
  if (!/^https:\/\//.test(meta.rg.url) || !/^https:\/\//.test(meta.rg.checksumUrl)) {
    throw new Error('core/vendor.json: "rg.url"/"rg.checksumUrl" must be https')
  }
  if (typeof meta.bwrap?.license !== 'string' || typeof meta.bwrap?.homepage !== 'string') {
    throw new Error('core/vendor.json: "bwrap.license"/"bwrap.homepage" must be strings')
  }
  if (!Array.isArray(meta.bwrap.installHints) || meta.bwrap.installHints.length === 0) {
    throw new Error('core/vendor.json: "bwrap.installHints" must be a non-empty array')
  }
  return meta
}

/**
 * Render the generated artifact module.
 * @param meta - validated `core/artifact.json`.
 */
function renderArtifact(meta) {
  return `/**
 * GENERATED from \`core/artifact.json\` by \`npm run sync:core-manifest\` — do not
 * edit by hand. \`npm run check:static\` fails when this file is stale.
 */

/** Artifact/hello version of the remote core (ADR-0024). */
export const CORE_ARTIFACT_VERSION = '${meta.version}'

/** Filename arch segment of the core tarball. */
export const CORE_ARTIFACT_ARCH = '${meta.arch}'
`
}

/**
 * Render the generated vendor-pin module.
 * @param meta - validated `core/vendor.json`.
 */
function renderVendor(meta) {
  const hints = meta.bwrap.installHints.map((hint) => `  ${JSON.stringify(hint)},`).join('\n')
  return `/**
 * GENERATED from \`core/vendor.json\` by \`npm run sync:core-manifest\` — do not
 * edit by hand. \`npm run check:static\` fails when this file is stale.
 */

/**
 * Official ripgrep release used when the remote host has no \`rg\` of its own.
 * Fetched at deploy time on the HOST, verified against {@link RG_VENDOR.sha256},
 * then pushed with the core; the plugin itself never redistributes it.
 */
export const RG_VENDOR = {
  version: ${JSON.stringify(meta.rg.version)},
  arch: ${JSON.stringify(meta.rg.arch)},
  url: ${JSON.stringify(meta.rg.url)},
  checksumUrl: ${JSON.stringify(meta.rg.checksumUrl)},
  sha256: ${JSON.stringify(meta.rg.sha256)},
  member: ${JSON.stringify(meta.rg.member)},
  license: ${JSON.stringify(meta.rg.license)},
  homepage: ${JSON.stringify(meta.rg.homepage)},
} as const

/**
 * bubblewrap has no upstream binary release (source tarball only), so it is
 * NEVER redistributed or downloaded: the remote host must already provide it.
 * A missing \`bwrap\` refuses the fenced operation with these install hints.
 */
export const BWRAP_VENDOR = {
  license: ${JSON.stringify(meta.bwrap.license)},
  homepage: ${JSON.stringify(meta.bwrap.homepage)},
  installHints: [
${hints}
  ],
} as const
`
}

const outputs = [
  { path: ARTIFACT_OUT, wanted: renderArtifact(readArtifactMeta()) },
  { path: VENDOR_OUT, wanted: renderVendor(readVendorMeta()) },
]

if (process.argv.includes('--check')) {
  const stale = []
  for (const output of outputs) {
    let current = ''
    try {
      current = readFileSync(output.path, 'utf8')
    } catch {
      // Missing file is stale by definition.
    }
    if (current.replace(/\r\n/g, '\n') !== output.wanted) stale.push(output.path.slice(ROOT.length + 1))
  }
  if (stale.length > 0) {
    console.error(`[sync-core-manifest] stale: ${stale.join(', ')} — run \`npm run sync:core-manifest\``)
    process.exit(1)
  }
  console.log('[sync-core-manifest] generated core modules match core/artifact.json + core/vendor.json')
} else {
  for (const output of outputs) {
    writeFileSync(output.path, output.wanted)
    console.log(`[sync-core-manifest] wrote ${output.path}`)
  }
}
