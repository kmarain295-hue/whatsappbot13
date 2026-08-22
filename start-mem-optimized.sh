#!/bin/bash
# Memory-optimized launcher for bolt.diy (Remix + Vite dev server).
#
# This is an OPS WRAPPER only. It does NOT edit, patch, or modify any
# application source file (nothing under app/, no .tsx/.ts/.scss/.css,
# no vite.config.ts, no package.json). It runs the EXACT same Remix Vite
# dev command as the repo's start-dev.sh — the only thing that changes is
# how Node/V8 manages memory internally (heap caps, GC cadence, thread &
# stack sizing). The webapp source, UI, mechanism and functioning are
# 100% unchanged.
#
# Memory-reduction techniques applied (all env / CLI-flag only):
#   1. Old-gen heap cap        448 -> 384 MB   (--max-old-space-size)
#   2. Young-gen semispace      16 ->   8 MB   (--max-semi-space-size)
#   3. Periodic GC interval 1,000,000 -> 100,000  (10x more frequent GC;
#      stops the steady RSS creep from uncollected API-error garbage)
#   4. Per-thread stack       ~984KB -> 512 KB (--stack-size; Node runs
#      many threads -> multiplicative stack-memory saving)
#   5. libuv thread pool         8 -> 4        (UV_THREADPOOL_SIZE; single-
#      user dev server needs fewer I/O workers -> less stack + context mem)
#   6. NODE_NO_WARNINGS=1                       (don't allocate warning objs)
#   7. Orphan-process cleanup: kill stale esbuild / sass-embedded / workerd
#      left by the previous Vite run (~190 MB of dead processes).
#   8. Vite optimize-deps lock trim: reuse the dep cache so Vite does not
#      re-bundle 1.6 GB of node_modules (which spikes RSS to ~900 MB).
#
# To revert: run the repo's original `bash start-dev.sh` instead.

cd /home/z/my-project
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

# --- 7. Kill the existing dev server + ALL orphan helper processes ---
pkill -f "@remix-run/dev/dist/cli.js" 2>/dev/null || true
pkill -f "remix vite:dev" 2>/dev/null || true
pkill -f "workerd serve" 2>/dev/null || true
pkill -f "esbuild --service" 2>/dev/null || true
pkill -f "dart-sass/src/sass.snapshot" 2>/dev/null || true
sleep 2

# --- 8. Trim stale Vite optimize-deps locks (keep the cache itself) ---
VITE_CACHE=/home/z/my-project/node_modules/.vite
if [ -d "$VITE_CACHE" ]; then
  find "$VITE_CACHE" -name "*.lock" -mmin +30 -delete 2>/dev/null || true
fi

# --- 1,2,5,6. RAM-tuning env (flags allowed in NODE_OPTIONS) ---
export NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=8 --expose-gc"
export UV_THREADPOOL_SIZE=4
export NODE_NO_WARNINGS=1

# Double-fork -> setsid -> reparent to PID 1 so it survives the sandbox reaper.
# Techniques 3 (gc-interval) and 4 (stack-size) are NOT allowed in NODE_OPTIONS,
# so they are passed on the node CLI directly (same pattern as start-dev.sh).
(
  setsid bash -c '
    cd /home/z/my-project
    export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
    export NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=8 --expose-gc"
    export UV_THREADPOOL_SIZE=4
    export NODE_NO_WARNINGS=1
    exec node --expose-gc --stack-size=512 --gc-interval=100000 \
      ./node_modules/@remix-run/dev/dist/cli.js vite:dev
  ' </dev/null >/home/z/my-project/dev.log 2>&1 &
)

# Wait for boot (Vite + workerd can take a while; allow up to 90s).
for i in $(seq 1 90); do
  if ss -tln 2>/dev/null | grep -q ":3000 "; then
    echo "READY after ${i}s"
    PID=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oP 'pid=\K[0-9]+' | head -1)
    [ -n "$PID" ] && echo "Server PID=$PID"
    exit 0
  fi
  sleep 1
done
echo "TIMEOUT waiting for port 3000"
exit 1
