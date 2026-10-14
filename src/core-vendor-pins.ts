/**
 * GENERATED from `core/vendor.json` by `npm run sync:core-manifest` — do not
 * edit by hand. `npm run check:static` fails when this file is stale.
 */

/**
 * Official ripgrep release used when the remote host has no `rg` of its own.
 * Fetched at deploy time on the HOST, verified against {@link RG_VENDOR.sha256},
 * then pushed with the core; the plugin itself never redistributes it.
 */
export const RG_VENDOR = {
  version: "15.2.0",
  arch: "x86_64-unknown-linux-musl",
  url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz",
  checksumUrl: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz.sha256",
  sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c",
  member: "ripgrep-15.2.0-x86_64-unknown-linux-musl/rg",
  license: "MIT OR UNLICENSE",
  homepage: "https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0",
} as const

/**
 * Official ripgrep pins keyed by core filename arch (REQ-I26). {@link RG_VENDOR}
 * stays the linux-x64 pin; deploy must not push that binary to another arch.
 */
export const RG_TARGETS = [
  { coreArch: "linux-x64", version: "15.2.0", arch: "x86_64-unknown-linux-musl", url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz", checksumUrl: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz.sha256", sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c", member: "ripgrep-15.2.0-x86_64-unknown-linux-musl/rg" },
  { coreArch: "linux-arm64", version: "15.2.0", arch: "aarch64-unknown-linux-musl", url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz", checksumUrl: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz.sha256", sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915", member: "ripgrep-15.2.0-aarch64-unknown-linux-musl/rg" },
] as const

/**
 * bubblewrap has no upstream binary release (source tarball only), so it is
 * NEVER redistributed or downloaded: the remote host must already provide it.
 * A missing `bwrap` refuses the fenced operation with these install hints.
 */
export const BWRAP_VENDOR = {
  license: "LGPL-2.1-or-later",
  homepage: "https://github.com/containers/bubblewrap",
  installHints: [
  "Debian/Ubuntu: sudo apt-get install -y bubblewrap",
  "Fedora/RHEL: sudo dnf install -y bubblewrap",
  "Arch: sudo pacman -S bubblewrap",
  "openSUSE: sudo zypper install bubblewrap",
  ],
} as const
