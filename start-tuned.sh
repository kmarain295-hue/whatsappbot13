#!/bin/bash
# RAM-tuned launcher for bolt.diy — DOES NOT EDIT ANY REPO FILE.
# This is a separate wrapper that runs the exact same Remix Vite dev command
# as the repo's start-dev.sh, but with tighter Node/V8 memory parameters.
#
# What changes: only how Node/V8 manages memory internally (heap caps, thread
# counts, stack size, GC cadence). The webapp source, UI, mechanism, and
# functioning are 100% unchanged.
#
# Techniques applied (all env/CLI-flag only):
#  1. Lower old-gen heap cap        448 -> 384 MB
#  2. Lower young-gen semispace      16 -> 8 MB   (more frequent minor GC)
#  3. Reduce libuv thread pool        8 -> 4      (single-user dev server)
#  4. Smaller per-thread stack        ~984KB -> 512 KB
#  5. Tighter periodic GC interval 1,000,000 -> 500,000 (reclaim sooner)
#
# To revert: just run the repo's original `bash start-dev.sh` instead.

cd /home/z/my-project

export PATH="$HOME/.local/bin:$PATH"

# Kill any existing dev server + orphan workerd from a previous run.
pkill -f "remix vite:dev" 2>/dev/null
pkill -f "@remix-run/dev/dist/cli.js" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "next dev -p 3000" 2>/dev/null
pkill -f "workerd serve" 2>/dev/null
sleep 1

# Trim stale Vite optimize-deps lock so the dep cache is reused.
VITE_CACHE=/home/z/my-project/node_modules/.vite
if [ -d "$VITE_CACHE" ]; then
  find "$VITE_CACHE" -name "*.lock" -mmin +30 -delete 2>/dev/null || true
fi

# ---- RAM-tuning env (techniques 1-3) ----
export NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=8"
export UV_THREADPOOL_SIZE=4

# Double-fork: subshell -> setsid -> background -> exec
# Techniques 4-5 passed on the node CLI (--stack-size, --gc-interval).
(
  setsid bash -c '
    cd /home/z/my-project
    export PATH="$HOME/.local/bin:$PATH"
    export NODE_OPTIONS="--max-old-space-size=384 --max-semi-space-size=8"
    export UV_THREADPOOL_SIZE=4
    exec node --expose-gc --stack-size=512 --gc-interval=500000 ./node_modules/@remix-run/dev/dist/cli.js vite:dev
  ' </dev/null >/home/z/my-project/dev.log 2>&1 &
)

# Wait for boot (Vite + workerd take longer than Next, allow up to 60s)
for i in $(seq 1 60); do
  if ss -tln 2>/dev/null | grep -q ":3000 "; then
    echo "READY after ${i}s"
    PID=$(ss -tlnp 2>/dev/null | grep ":3000 " | grep -oP 'pid=\K[0-9]+' | head -1)
    if [ -n "$PID" ]; then
      PPID_VAL=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')
      echo "Server PID=$PID PPID=$PPID_VAL"
    fi
    exit 0
  fi
  sleep 1
done
echo "TIMEOUT"
exit 1
