#!/usr/bin/env bash
# Stop the local dev stack.
cd "$(dirname "$0")/.."
for p in ingestion broker; do
  if [ -f "data/$p.pid" ]; then
    kill "$(cat data/$p.pid)" 2>/dev/null && echo "stopped $p (pid $(cat data/$p.pid))"
    rm -f "data/$p.pid"
  fi
done
