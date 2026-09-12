#!/usr/bin/env bash
# Start the local dev stack (no Docker): headless MQTT broker + ingestion.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=./.venv/bin/python
export HISTORIAN_BACKEND="${HISTORIAN_BACKEND:-sqlite}"
mkdir -p data
nohup "$PY" scripts/dev_broker.py      > data/broker.log    2>&1 & echo $! > data/broker.pid
sleep 1
nohup "$PY" services/ingestion/main.py > data/ingestion.log 2>&1 & echo $! > data/ingestion.pid
echo "broker    pid $(cat data/broker.pid)   -> data/broker.log"
echo "ingestion pid $(cat data/ingestion.pid)   -> data/ingestion.log (backend=$HISTORIAN_BACKEND)"
echo
echo "Now stream a scenario, e.g.:"
echo "  $PY edge/emulator/emulator.py --scenario bottleneck --speed 20"
echo "Then check the historian:"
echo "  $PY scripts/historian_check.py"
echo "Stop the stack with: scripts/dev_down.sh"
