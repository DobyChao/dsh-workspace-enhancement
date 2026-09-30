/**
 * GENERATED from `core/artifact.json` by `npm run sync:core-manifest` — do not
 * edit by hand. `npm run check:static` fails when this file is stale.
 */

/** Artifact/hello version of the remote core (ADR-0024). */
export const CORE_ARTIFACT_VERSION = '0.2.2'

/** Filename arch segment of the core tarball. */
export const CORE_ARTIFACT_ARCH = 'linux-x64'

/**
 * sha256 of every dsh-core binary the fence may run (REQ-I17 provenance
 * gate, 2026-09-30). The serve-open path hashes the remote binary and
 * refuses anything not on this list; the static gate additionally fails when
 * the dist tarball's own binary is missing from it (a core bump that forgot
 * to register its hash can never ship).
 */
export const CORE_COMPAT_HASHES = [
  'a0f28eaef7e608b2339fb6691ec9569c192ccd02ed20ffda894762a598ebf62d',
] as const
