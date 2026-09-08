#!/usr/bin/env bash
# scripts/verify-linux.sh — run the full quality gate on a real Linux filesystem.
#
# Why: CI runs ubuntu + windows, but pushing is the slow way to discover a
# platform assumption. On a Windows host with WSL installed this verifies the
# ubuntu job locally, before the commit leaves the machine.
#
#   wsl -e bash -lc "bash /mnt/d/<repo>/.tmp/verify-linux.sh"
#
# It copies the working tree into a scratch directory on the Linux filesystem
# (node_modules is platform-specific, so it must be reinstalled there), runs
# `npm ci` once, then the same commands CI runs. The Windows working tree is
# never touched.
set -euo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DST="${DSW_VERIFY_DIR:-$HOME/dsw-verify}"

echo "== source: $SRC"
echo "== scratch: $DST"
rm -rf "$DST"
mkdir -p "$DST"
cd "$SRC"
tar --exclude=./node_modules --exclude=./lib --exclude=./.tmp \
    --exclude=./e2e/artifacts --exclude=./.agent-teams --exclude=./.workbuddy \
    -cf - . | (cd "$DST" && tar -xf -)

cd "$DST"
echo "== node $(node -v) / npm $(npm -v)"
echo "== npm ci"
npm ci --no-audit --no-fund >/tmp/dsw-verify-npmci.log 2>&1 || { echo "npm ci FAILED"; tail -20 /tmp/dsw-verify-npmci.log; exit 1; }

echo "== npm run check:static"
npm run check:static

echo "== npm run typecheck"
npm run typecheck

echo "== npm test"
if npm test >/tmp/dsw-verify-test.log 2>&1; then TEST_EXIT=0; else TEST_EXIT=$?; fi
grep -E '^ℹ (tests|pass|fail|skipped)' /tmp/dsw-verify-test.log || true
grep -E '^✖' /tmp/dsw-verify-test.log | head -20 || true
echo "TEST_EXIT=$TEST_EXIT"

echo "== npm run build"
npm run build | tail -3

echo "== pack smoke"
node scripts/pack-smoke.mjs | tail -3

echo "== done (TEST_EXIT=$TEST_EXIT)"
exit "$TEST_EXIT"
