/**
 * GENERATED from `core/artifact.json` by `npm run sync:core-manifest` — do not
 * edit by hand. `npm run check:static` fails when this file is stale.
 */

/** Artifact/hello version of the remote core (ADR-0024). */
export const CORE_ARTIFACT_VERSION = '0.2.5'

/** Filename arch segment of the primary (linux-x64) core tarball. */
export const CORE_ARTIFACT_ARCH = 'linux-x64'

/**
 * Every architecture this package ships (REQ-I26). Deploy picks a row by
 * `uname -m`; the filename arch is {@link CORE_ARTIFACT_ARCH} only for the
 * primary target.
 */
export const CORE_ARTIFACT_TARGETS = [
  { arch: 'linux-x64', manifestArch: 'linux-x86_64', uname: ['x86_64', 'amd64', 'x64'] },
  { arch: 'linux-arm64', manifestArch: 'linux-aarch64', uname: ['aarch64', 'arm64'] },
] as const

/**
 * sha256 of every dsh-core binary the fence may run (REQ-I17 provenance
 * gate, 2026-09-30). The serve-open path hashes the remote binary and
 * refuses anything not on this list; the static gate additionally fails when
 * the dist tarball's own binary is missing from it (a core bump that forgot
 * to register its hash can never ship).
 */
export const CORE_COMPAT_HASHES = [
  'a0f28eaef7e608b2339fb6691ec9569c192ccd02ed20ffda894762a598ebf62d',
  'd35cb7f3dc491f271a65602c5e8fcebd4da8fcfac48d0f0352c25eecb7e6a4c0',
  '89404e159e8abca8957d535bfa026f4ba49cc776fa6e26edf0462867be5c0fff',
  '261a4f9dc7500c39096d819cca2650851ba5e5c31d5b75df9beda0cc2ba3ad81',
  '369d939e85f331b277f7eebe324cbb983bba2641966a18ee8c4fc9086d4a99b2',
  'b96ae3b4fd05de7ffae02497d257f82dc9d4d62b1c8c17a8df394cb81614f446',
  'b500669890bf9dfd1b81b4b52131de58bf9c98a98798538109ee6af2cabe2fc9',
] as const
