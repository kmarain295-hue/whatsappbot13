#!/bin/bash
# Adapted dev launcher + watchdog for /home/z/my-project (project moved here).
# Restarts the Remix+Vite dev server if it exits. Runs detached via setsid.
set -u
cd /home/z/my-project

LOG=/home/z/my-project/dev.log
WDLOG=/home/z/my-project/watchdog.log

export NODE_OPTIONS="--max-old-space-size=640 --max-semi-space-size=32"
export UV_THREADPOOL_SIZE=8

VITE_CACHE=/home/z/my-project/node_modules/.vite
if [ -d "$VITE_CACHE" ]; then
  find "$VITE_CACHE" -name "*.lock" -mmin +30 -delete 2>/dev/null || true
fi

kill_orphan_workerd() {
  pkill -f "workerd serve" 2>/dev/null || true
}

while true; do
  if ! pgrep -f "remix vite:dev" > /dev/null 2>&1; then
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] killing orphan workerd..." >> "$WDLOG"
    kill_orphan_workerd
    sleep 1
    echo "[$(date '+%a %b %d %H:%M:%S UTC %Y')] starting dev server..." >> "$WDLOG"
    : > "$LOG"
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
