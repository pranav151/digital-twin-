#!/usr/bin/env bash
# Factory Twin — stop the whole stack (whatever run_all.sh started, plus strays).
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

# 1) kill by recorded PID files
for f in "$ROOT"/data/*.pid; do
  [ -e "$f" ] || continue
  pid="$(cat "$f" 2>/dev/null)"
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
  rm -f "$f"
done

# 2) belt-and-suspenders: kill by command pattern
pkill -f "scripts/dev_broker.py"           2>/dev/null
pkill -f "services/ingestion/main.py"      2>/dev/null
pkill -f "edge/emulator/emulator.py"       2>/dev/null
pkill -f "services.connectors"             2>/dev/null
pkill -f "uvicorn backend.app.main"        2>/dev/null
pkill -f "frontend/node_modules/.bin/vite" 2>/dev/null

# 3) free the ports just in case
lsof -ti :8020 2>/dev/null | xargs kill 2>/dev/null
lsof -ti :5173 2>/dev/null | xargs kill 2>/dev/null

echo "Factory Twin stopped."
