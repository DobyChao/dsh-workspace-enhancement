/**
 * GENERATED from `core/artifact.json` by `npm run sync:core-manifest` — do not
 * edit by hand. `npm run check:static` fails when this file is stale.
 */

/** Artifact/hello version of the remote core (ADR-0024). */
export const CORE_ARTIFACT_VERSION = '0.2.7'

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
  '523d0a2daf2738106f6fd417c579599cc6d28d850329fca45a368f905a9f72b8',
  '3b088875fdba7640e1a07cffbcb1684385f083fb2111891156917b51f8b7aa59',
  '4cbc0cea1175517fc1c86985572a7a480ae739ecf6bf33c590af75e82edfb583',
  'b5dcb8ece7e505eb3a63e68265285b04e47900a9007bd2f2bac5209f18bb75c5',
  'e041bb7d6a56b7da1736709450e1044c4d454cd60141c356e162738ddb97288c',
  '2eb2af6ee0d43d0ead9dc4f2c17d02f698039adfcef9ddeb8187945b4ff602da',
  '1265e0281a840832e04d9c062a3be08b1de184ed5d4d62193a4dc7a30bf6030b',
  '6166d582be61659af8d0898ec06636636113329cef57aac3980d4134bb7cc339',
  '09801e654349de585f69252f5cf7a5a89d6b4097096a335350c57597b07c18b9',
  '6ffb9fd48db4d7256e6e10797df329a5361d1d06c4b15f8470ca7a4d1b737ad9',
  '74c2f7bf595c4fb0ff1929f8293b53c940b7a5be5953b108f54a987458e5a623',
  '64f22ba948faf80655df4abbf5f5284f47453cf01f864ae4143edcdbc8dd96da',
  '06ccbb97e8b053654db5ecb8ba9cacd6c4e1b2a6f82c903ed51ff8e34787d14d',
  '3db94c5175d73508643d9bb0a15b45f1f3bd97b8d6f9410cbe6130bce8f5f0dc',
  'd9a02a8adc276d8d3d3ae2d4deb3dd286374b84991281fd8aee6a36506b8c6c5',
  'ebceaccc7888ee6a1167f15e157047109e8858e2fa170bb3f1cab276ce7a7eae',
  '152c3a06258902350ddda7f486482ba34b62f2ccc2a50866cde5e2f33dcfe3c0',
] as const
