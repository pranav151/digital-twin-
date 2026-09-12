#!/usr/bin/env bash
# Factory Twin — start the ENTIRE stack DETACHED so it keeps running on its own
# (survives closing the terminal and needs no chat/agent babysitting it).
#   Start:  scripts/run_all.sh
#   Stop:   scripts/stop_all.sh
#   Logs:   data/<name>.log     PIDs: data/<name>.pid
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
PY="$ROOT/.venv/bin/python"
UVICORN="$ROOT/.venv/bin/uvicorn"
VITE="$ROOT/frontend/node_modules/.bin/vite"
mkdir -p data

echo "· clearing anything already running…"
"$ROOT/scripts/stop_all.sh" >/dev/null 2>&1
sleep 1

export HISTORIAN_BACKEND=sqlite
export DATA_SOURCE=emulator

# start <name> <command...>  — launch detached (nohup + disown + no stdin)
start(){ local name="$1"; shift
  nohup "$@" >"$ROOT/data/$name.log" 2>&1 </dev/null & disown
  echo $! > "$ROOT/data/$name.pid"
  echo "  ✓ $name (pid $(cat "$ROOT/data/$name.pid"))"
}

# 1) message bus
start broker    "$PY" scripts/dev_broker.py;      sleep 1
# 2) ingestion → historian
start ingestion "$PY" services/ingestion/main.py; sleep 1
# 3) the four line emulators
for s in fullplant line2 bmw_x5 bmw_engine toyota_wh; do
  start "emu_$s" "$PY" edge/emulator/emulator.py --scenario "$s" --speed 1 --quiet
done
# 4) live MTConnect connectors → real data on S15 / S16 / S17
MTCONNECT_URL="https://demo.mtconnect.org" MTCONNECT_DEVICE_MAP='{"OKUMA":"S15","Mazak":"S16"}' \
  start conn_demo  "$PY" -m services.connectors --source mtconnect
MTCONNECT_URL="http://mtconnect.mazakcorp.com:5610" MTCONNECT_DEVICE_MAP='{"MFMS10-MC2":"S17"}' \
  start conn_mazak "$PY" -m services.connectors --source mtconnect
# 5) backend API + live hub
start backend "$UVICORN" backend.app.main:app --host 127.0.0.1 --port 8020 --log-level warning
# 6) frontend (Vite dev server)
( cd frontend && BACKEND_PORT=8020 nohup "$VITE" --port 5173 >"$ROOT/data/vite.log" 2>&1 </dev/null & disown
  echo $! > "$ROOT/data/vite.pid" )
echo "  ✓ vite (pid $(cat "$ROOT/data/vite.pid"))"

echo
echo "Factory Twin is up and detached.  Open →  http://localhost:5173"
echo "Stop everything with →  scripts/stop_all.sh"
