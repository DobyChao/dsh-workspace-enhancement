#!/usr/bin/env bash
# scripts/dev-lab-wsl.sh — the LINUX-host lab (INFRA-19). Run INSIDE WSL.
#
# Usage (inside WSL, or via scripts/dev-lab-wsl.ps1 from Windows):
#   bash scripts/dev-lab-wsl.sh                     # ensure CLI + install plugin tarball + boot (foreground)
#   bash scripts/dev-lab-wsl.sh --smoke             # background boot + HTTP/channel probe + stop
#   bash scripts/dev-lab-wsl.sh --tgz <path>        # explicit tarball (default: newest .tmp/dsh-workspace-enhancement-*.tgz)
#   bash scripts/dev-lab-wsl.sh --tag next          # host dist-tag for the CLI install (default next — the family the peers pin)
#   bash scripts/dev-lab-wsl.sh --port 50600 --home ~/.dsh-lab-wsl --no-boot
#
# Safety boundary (mirrors dev-lab.ps1):
#   - DSH_HOME defaults to $HOME/.dsh-lab-wsl (WSL filesystem — NOT /mnt/* and
#     never the product home); port 50600, never 3080.
#   - The plugin is installed from the npm pack TARBALL, the same artifact real
#     installs use (AGENTS.md §3).
set -euo pipefail

PORT=50600
TAG=next
HOME_DIR="$HOME/.dsh-lab-wsl"
TGZ=""
SMOKE=0
NO_BOOT=0
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --tgz) TGZ="$2"; shift 2 ;;
    --smoke) SMOKE=1; shift ;;
    --no-boot) NO_BOOT=1; shift ;;
    *) echo "[lab-wsl] unknown argument: $1 (see header for usage)" >&2; exit 2 ;;
  esac
done

if [ "$PORT" -eq 3080 ]; then echo "[lab-wsl] port 3080 belongs to the real GUI; use 50600" >&2; exit 2; fi
if ! uname -r | grep -qi microsoft; then
  echo "[lab-wsl] this script must run INSIDE WSL (uname -r lacks 'microsoft')." >&2
  echo "           From Windows: pwsh -File scripts/dev-lab-wsl.ps1" >&2
  exit 2
fi

mkdir -p "$HOME_DIR"
export DSH_HOME="$HOME_DIR"
echo "[lab-wsl] DSH_HOME = $DSH_HOME"
echo "[lab-wsl] repo     = $REPO"

# -- 1) host CLI: installed when missing; --tag forces the pinned family -----
# Non-login shells miss the profile PATH (nvm, ~/.local/node/bin), so probe the
# common Linux prefixes first. WSL also inherits the Windows PATH, where
# `command -v dsh` resolves the WINDOWS npm shim under /mnt/* — a Linux lab
# must only accept a LINUX-side binary.
for candidate in "$HOME/.local/node/bin" "$HOME/.local/bin" /usr/local/bin; do
  if [ -x "$candidate/node" ] || [ -x "$candidate/npm" ]; then PATH="$candidate:$PATH"; fi
done
linux_bin() {
  local found
  found="$(command -v "$1" 2>/dev/null || true)"
  if [ -n "$found" ] && [ "${found#/mnt/}" = "$found" ]; then printf '%s' "$found"; fi
}
DSH_BIN="$(linux_bin dsh)"
install_cli() {
  if [ -z "$(linux_bin npm)" ]; then
    echo "[lab-wsl] no LINUX-side npm found (the /mnt/* one belongs to Windows)." >&2
    echo "           Install Node inside WSL first (e.g. apt install nodejs npm, or nvm)." >&2
    exit 1
  fi
  echo "[lab-wsl] installing @deepseek-ai/dsh@$TAG (npm install -g) ..."
  # Registry reachability in WSL is proxy-sensitive (R41: the 7890 proxy flaked
  # TLS for fresh tarballs). A failed install prints the npm error verbatim;
  # retrying with `no_proxy=registry.npmjs.org` is the known workaround.
  if ! npm install -g "@deepseek-ai/dsh@$TAG" 2>&1 | tail -5; then
    echo "[lab-wsl] npm install failed — if the error is a proxy TLS reset, retry with:" >&2
    echo "           no_proxy=registry.npmjs.org bash $0 $*" >&2
    exit 1
  fi
  DSH_BIN="$(linux_bin dsh)"
  if [ -z "$DSH_BIN" ]; then echo "[lab-wsl] dsh still not on the Linux PATH after install" >&2; exit 1; fi
}
if [ -z "$DSH_BIN" ]; then install_cli; fi

# Family check (matrix §1: the lab family follows the peer pin). An ancient
# CLI (this machine carried 0.1.0-rc.6) writes a profile WITHOUT the pnpm 10/11
# accommodations the current host writes (`allowBuilds: ssh2` etc.), and the
# plugin install then dies on ERR_PNPM_IGNORED_BUILDS — so a mismatched family
# is upgraded, and the throwaway profile is reset to avoid mixed-state formats.
ver_core() { node -e "const m=/(\d+\.\d+\.\d+)/.exec(String(process.argv[1]||'')); process.stdout.write(m?m[1]:'')" "$1"; }
PIN_CORE="$(ver_core "$(node -e "process.stdout.write(require('$REPO/package.json').peerDependencies['@deepseek-ai/dsh-fs']||'')" 2>/dev/null || true)")"
CLI_CORE="$(ver_core "$("$DSH_BIN" --version 2>/dev/null || true)")"
if [ -n "$PIN_CORE" ] && [ "$CLI_CORE" != "$PIN_CORE" ]; then
  echo "[lab-wsl] family mismatch: CLI ${CLI_CORE:-?} != peer pin $PIN_CORE — reinstalling @$TAG and resetting the lab profile"
  install_cli
  CLI_CORE="$(ver_core "$("$DSH_BIN" --version 2>/dev/null || true)")"
  rm -rf "$DSH_HOME/profiles"
  if [ "$CLI_CORE" != "$PIN_CORE" ]; then
    echo "[lab-wsl] WARNING: @$TAG resolved to ${CLI_CORE:-?}, still != pin $PIN_CORE — the channel has moved past the pin." >&2
    echo "           Proceeding (drift/tag-watch owns that policy); double-check which family this lab run actually tests." >&2
  fi
fi
echo "[lab-wsl] dsh CLI: $DSH_BIN ($("$DSH_BIN" --version 2>/dev/null || echo 'version unknown'))"

# -- 2) plugin tarball: newest pack artifact unless told otherwise -----------
if [ -z "$TGZ" ]; then
  TGZ="$(ls -1t "$REPO"/.tmp/dsh-workspace-enhancement-*.tgz 2>/dev/null | head -1 || true)"
fi
if [ -z "$TGZ" ] || [ ! -f "$TGZ" ]; then
  echo "[lab-wsl] no plugin tarball under $REPO/.tmp — run \`npm run build && npm pack\` in the repo first (or pass --tgz)" >&2
  exit 1
fi
echo "[lab-wsl] tarball  = $TGZ"

# -- 3) profile install: same remove/add pair the win32 lab uses -------------
# The host's initProfile writes pnpm-workspace.yaml with an OPERATOR DECISION
# left as placeholders (`allowBuilds: {cpu-features|ssh2: set this to true or
# false}`) — pnpm then fails the install with ERR_PNPM_IGNORED_BUILDS until
# someone fills it in (the win32 lab had this done by hand). This is a
# throwaway lab home, so the script makes that call itself: allow both native
# builds, then retry the add.
WS_YAML="$DSH_HOME/profiles/web/pnpm-workspace.yaml"
dsw_add() { "$DSH_BIN" plugin --profile web add "$TGZ"; }
"$DSH_BIN" plugin --profile web remove dsh-workspace-enhancement >/dev/null 2>&1 || true
if ! dsw_add; then
  if [ -f "$WS_YAML" ] && grep -q 'set this to true or false' "$WS_YAML"; then
    echo "[lab-wsl] filling the host's allowBuilds placeholders (cpu-features, ssh2) for this throwaway lab home"
    sed -i 's/set this to true or false/true/g' "$WS_YAML"
  fi
  dsw_add
fi

# -- 4) boot ------------------------------------------------------------------
if [ "$NO_BOOT" -eq 1 ]; then
  echo "[lab-wsl] --no-boot: profile ready, not starting web."
  exit 0
fi

if [ "$SMOKE" -eq 1 ]; then
  LOG="$(mktemp -t lab-wsl-XXXXXX.log)"
  echo "[lab-wsl] smoke: dsh web --port $PORT --no-open (background, log $LOG)"
  "$DSH_BIN" web --port "$PORT" --no-open >"$LOG" 2>&1 &
  PID=$!
  cleanup() {
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" 2>/dev/null || true
    echo "[lab-wsl] smoke: server stopped."
  }
  trap cleanup EXIT
  # Boot = the listening URL line (mirrors boot-smoke); a bare GET / answers
  # 303-with-cookie, not 200, so the session is redeemed before probing.
  URL=""
  for _ in $(seq 1 40); do
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "[lab-wsl] smoke: dsh web exited early; last log lines:" >&2
      tail -20 "$LOG" >&2
      exit 1
    fi
    URL="$(grep -o 'http://127\.0\.0\.1:[0-9]*/?token=[A-Za-z0-9._-]*' "$LOG" | tail -1 || true)"
    [ -n "$URL" ] && break
    sleep 3
  done
  if [ -z "$URL" ]; then echo "[lab-wsl] smoke: no listening URL within 120s; see $LOG" >&2; exit 1; fi
  echo "[lab-wsl] smoke: listening ($URL)"
  JAR="$(mktemp -t lab-wsl-jar-XXXXXX)"
  CODE="$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' "$URL" || true)"
  echo "[lab-wsl] smoke: GET /?token=… -> $CODE (303/200 expected)"
  case "$CODE" in
    200|303) ;;
    *) echo "[lab-wsl] smoke: FAIL — token redeem returned $CODE" >&2; exit 1 ;;
  esac
  CODE="$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  echo "[lab-wsl] smoke: GET / (session) -> $CODE"
  [ "$CODE" = "200" ] || { echo "[lab-wsl] smoke: FAIL — session root not 200" >&2; exit 1; }
  BODY='{"type":"client-request","rpcId":"lab-wsl-smoke-1","method":"dsw/connections.list","payload":{}}'
  RES="$(curl -s -b "$JAR" -X POST "http://127.0.0.1:$PORT/api/dsw/connections.list" -H 'content-type: application/json' -d "$BODY" || true)"
  echo "[lab-wsl] smoke: POST /api/dsw/connections.list -> $RES"
  case "$RES" in
    *'"ok":true'*|*'"ok": true'*) echo "[lab-wsl] smoke: PASS" ;;
    *) echo "[lab-wsl] smoke: FAIL — channel envelope not ok=true" >&2; exit 1 ;;
  esac
  exit 0
fi

echo "[lab-wsl] booting: dsh web --port $PORT --no-open"
echo "[lab-wsl] verify at http://127.0.0.1:$PORT/ (from Windows too — WSL forwards localhost); Ctrl+C to stop"
exec "$DSH_BIN" web --port "$PORT" --no-open
