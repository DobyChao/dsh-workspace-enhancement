#!/usr/bin/env bash
# scripts/boot-smoke.sh — isolated-lab boot + liveness smoke for
# dsh-workspace-enhancement (AGENTS.md §4: pre-publish/pre-deploy gate).
#
# POSIX equivalent of `pwsh -File scripts/dev-lab.ps1 -Smoke` (the native
# Windows launcher). Works from Git-Bash / WSL / macOS / Linux with `node`,
# `dsh` and curl on PATH. Always uses an isolated DSH_HOME (default
# $HOME/.dsh-lab) and a non-production port (default 50599) — never 3080.
#
# Usage:
#   bash scripts/boot-smoke.sh              # defaults: port 50599, $HOME/.dsh-lab
#   PORT=50600 DSH_HOME=/tmp/dsh-lab-smoke bash scripts/boot-smoke.sh
set -u

PORT="${PORT:-50599}"
if [ "$PORT" = "3080" ]; then
  echo "[boot-smoke] port 3080 belongs to the real GUI; use another port" >&2
  exit 1
fi

DSH_HOME="${DSH_HOME:-${HOME}/.dsh-lab}"
export DSH_HOME

# Safety: never boot against the REAL profile home (the production instance).
# The dev environment may export DSH_HOME already; a sane default is the
# isolated sandbox, and an inherited real home must be refused loudly.
norm() { printf '%s' "$1" | sed -e 's#\\\\#/#g' -e 's#/\+$##' ; }
if [ "$(norm "$DSH_HOME")" = "$(norm "${HOME}/.dsh")" ]; then
  echo "[boot-smoke] REFUSING: DSH_HOME points at the real profile home ($DSH_HOME)" >&2
  echo "[boot-smoke] set DSH_HOME to an isolated sandbox home (e.g. \${HOME}/.dsh-lab)" >&2
  exit 1
fi
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/.tmp"
mkdir -p "$LOG_DIR" || exit 1

echo "[boot-smoke] DSH_HOME = $DSH_HOME"
echo "[boot-smoke] repo     = $REPO_DIR"
echo "[boot-smoke] port     = $PORT (isolated; 3080 is never reused)"

# -- build artifacts must exist ---------------------------------------------
[ -f "$REPO_DIR/lib/index.js" ] || { echo "[boot-smoke] lib/index.js missing — run: npm run build" >&2; exit 1; }
[ -f "$REPO_DIR/lib/client.js" ] || { echo "[boot-smoke] lib/client.js missing — run: npm run build" >&2; exit 1; }

# -- profile: install this repo into the isolated profile --------------------
echo "[boot-smoke] dsh plugin --profile web add <repo> ..."
dsh plugin --profile web add "$REPO_DIR" >"$LOG_DIR/boot-smoke.plugin.log" 2>&1 || {
  echo "[boot-smoke] dsh plugin add failed" >&2
  tail -20 "$LOG_DIR/boot-smoke.plugin.log" >&2
  exit 1
}

# -- boot web in the background ---------------------------------------------
echo "[boot-smoke] starting: dsh web --port $PORT --no-open"
dsh web --port "$PORT" --no-open \
  >"$LOG_DIR/boot-smoke.stdout.log" 2>"$LOG_DIR/boot-smoke.stderr.log" &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  sleep 1
  # the dsh shim may leave the node child alive; free the port as well.
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "${PORT}/tcp" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# -- wait for HTTP 200 --------------------------------------------------------
deadline=$(( $(date +%s) + 120 ))
status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[boot-smoke] dsh web exited early" >&2
    tail -40 "$LOG_DIR/boot-smoke.stderr.log" >&2
    exit 1
  fi
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  if [ "$status" = "200" ]; then break; fi
  sleep 3
done

if [ "$status" != "200" ]; then
  echo "[boot-smoke] web did not answer 200 within 120s (last=$status)" >&2
  tail -40 "$LOG_DIR/boot-smoke.stderr.log" >&2
  exit 1
fi
echo "[boot-smoke] HTTP 200 on http://127.0.0.1:$PORT/"

# -- client bundle referenced by the served index -----------------------------
if curl -s --max-time 3 "http://127.0.0.1:$PORT/" | grep -q 'dsh-workspace-enhancement/client\.js'; then
  echo "[boot-smoke] index references plugin client bundle: True"
else
  echo "[boot-smoke] index references plugin client bundle: False" >&2
  exit 1
fi

# -- /dsw RPC channel probe ---------------------------------------------------
body='{"type":"client-request","rpcId":"boot-smoke-1","method":"connections.list","payload":{}}'
rpc="$(curl -s --max-time 10 -X POST -H 'Content-Type: application/json' \
  -d "$body" "http://127.0.0.1:$PORT/dsw/connections.list" || true)"
if echo "$rpc" | grep -q '"ok":true'; then
  echo "[boot-smoke] POST /dsw/connections.list -> ok=true"
else
  echo "[boot-smoke] POST /dsw/connections.list -> NOT ok: $rpc" >&2
  exit 1
fi

echo "[boot-smoke] PASS (HTTP + client bundle + /dsw RPC channel)"
exit 0
