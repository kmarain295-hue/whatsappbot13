#!/bin/bash
# bolt.diy memory-optimized dev launcher + watchdog (single source of truth).
#
# Memory-reduction techniques applied:
#   1. Node.js old-generation heap capped at 640MB (--max-old-space-size=640).
#      Was 1024MB before. 640MB is enough for the Remix+Vite dev server and
#      leaves headroom for the agent-browser Chrome on the same 4GB box.
#      The cap PREVENTS the unbounded heap growth that caused OOM kills.
#   2. V8 semi-space capped at 32MB (--max-semi-space-size=32). Default is
#      64MB on 64-bit; halving it cuts young-gen pause memory with negligible
#      throughput impact for a dev server.
#   3. UV_THREADPOOL_SIZE=8 (from default 4). Lets libuv do more concurrent
#      I/O without Node spawning extra worker processes.
#   4. DEFAULT_NUM_CTX=8192 (in .env.local, was 32768) — 4x smaller context
#      window per request, saving ~KBs of resident memory per active stream.
#   5. Pre-start cleanup of stale .vite lock files so Vite reuses the dep
#      cache (re-bundling 1.6GB of node_modules spikes memory to ~900MB).
#   6. Orphan-workerd cleanup: each Vite restart leaves the previous workerd
#      pair behind (~88MB). The watchdog kills all workerd processes before
#      starting a fresh server so they do not accumulate.
#   7. strictPort: true in vite.config.ts — Vite EXITS on port collision
#      instead of silently moving to 3001 (which Caddy can't reach). The
#      watchdog then retries until TIME_WAIT sockets clear.
#   8. Single watchdog only (was 4 duplicate scripts fighting before).
#
# What is NOT disabled (tried, broke the app):
#   - Cloudflare dev proxy (workerd): REQUIRED. remix-island imports
#     `react-dom/server` which only exports `renderToReadableStream` as a
#     named ESM export in the worker/browser build that workerd resolves to.
#     Removing the proxy → CJS interop failure → blank page.
#   - COOP/COEP headers: REQUIRED. @webcontainer/api needs SharedArrayBuffer
#     for cross-origin isolation. Removing them → silent hydration failure.
#
# Usage:
#   ./dev-optimized.sh            # foreground
#   nohup ./dev-optimized.sh &    # background (logs to dev-server.log)

set -u
cd /home/z/bolt.diy

LOG=/home/z/bolt.diy/dev-server.log
WDLOG=/home/z/bolt.diy/watchdog.log

# Memory caps (tune here, single place).
export NODE_OPTIONS="--max-old-space-size=640 --max-semi-space-size=32"
export UV_THREADPOOL_SIZE=8
# SKIP_CLOUDFLARE_PROXY and ENABLE_COOP_COEP are read from .env.local by
# vite.config.ts at boot. Do NOT override them here.
# - SKIP_CLOUDFLARE_PROXY=0 (proxy ON — required for SSR)
# - ENABLE_COOP_COEP=1 (headers ON — required for @webcontainer/api)

# Pre-start: trim the .vite cache of any stale optimize-deps lock so Vite
# does not refuse to reuse the cache after a crash. We do NOT delete the
# optimized deps themselves — re-bundling 1.6GB of node_modules spikes RAM.
VITE_CACHE=/home/z/bolt.diy/node_modules/.vite
if [ -d "$VITE_CACHE" ]; then
  find "$VITE_CACHE" -name "*.lock" -mmin +30 -delete 2>/dev/null || true
fi

# Kill orphan workerd processes left by a previous Vite run. Each Vite
# restart spawns a fresh workerd pair but does not kill the old one, so
# they accumulate (~44MB each). Nuke them all before starting.
kill_orphan_workerd() {
  pkill -f "workerd serve" 2>/dev/null || true
}

# Single watchdog loop.
while true; do
  if ! pgrep -f "remix vite:dev" > /dev/null 2>&1; then
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] killing orphan workerd..." >> "$WDLOG"
    kill_orphan_workerd
    sleep 1
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] starting dev server (NODE_OPTIONS=$NODE_OPTIONS)..." >> "$WDLOG"
    node ./node_modules/@remix-run/dev/dist/cli.js vite:dev >> "$LOG" 2>&1 &
    PID=$!
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] started PID $PID" >> "$WDLOG"
    wait $PID 2>/dev/null
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] server exited (code $?)" >> "$WDLOG"
    sleep 3
  else
    sleep 10
  fi
done
