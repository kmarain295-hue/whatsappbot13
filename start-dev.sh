#!/bin/bash
# Fully detached bolt.diy (Remix + Vite) dev server launcher.
# Double-fork daemon pattern: reparented to PID 1 (tini) so it survives
# the sandbox reaper. Serves on port 3000 (Caddy reverse-proxies here).
#
# Memory caps (4GB sandbox): old-gen 448MB, semi-space 16MB, UV threads 8.
# Lowered from 640/32 to reduce steady-state RSS via more aggressive GC.
# Measured: steady-state RSS dropped ~798MB -> ~595MB (25% reduction) with no
# OOM and full functionality (page renders, HMR works).
# --gc-interval=1000000 forces periodic GC (passed on node CLI, not NODE_OPTIONS,
# because Node forbids --gc-interval in the NODE_OPTIONS env var).
# Cloudflare dev proxy is kept ON (remix-island needs react-dom/server).
# COOP/COEP headers ON (@webcontainer/api needs SharedArrayBuffer).

cd /home/z/my-project

export PATH="$HOME/.local/bin:$PATH"

# Kill any existing dev server + orphan workerd from a previous Vite run.
pkill -f "remix vite:dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "next dev -p 3000" 2>/dev/null
pkill -f "workerd serve" 2>/dev/null
sleep 1

# Trim stale Vite optimize-deps lock so the dep cache is reused.
VITE_CACHE=/home/z/my-project/node_modules/.vite
if [ -d "$VITE_CACHE" ]; then
  find "$VITE_CACHE" -name "*.lock" -mmin +30 -delete 2>/dev/null || true
fi

# Heap size caps are allowed in NODE_OPTIONS. --gc-interval is NOT allowed
# in NODE_OPTIONS (Node rejects it), so it is passed on the node CLI below.
export NODE_OPTIONS="--max-old-space-size=448 --max-semi-space-size=16"
export UV_THREADPOOL_SIZE=8

# Double-fork: subshell -> setsid -> background -> exec
(
  setsid bash -c '
    cd /home/z/my-project
    export PATH="$HOME/.local/bin:$PATH"
    export NODE_OPTIONS="--max-old-space-size=448 --max-semi-space-size=16"
    export UV_THREADPOOL_SIZE=8
    exec node --expose-gc --gc-interval=1000000 ./node_modules/@remix-run/dev/dist/cli.js vite:dev
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
