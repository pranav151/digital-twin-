# Real-Time Factory Digital Twin

A low-cost, self-calibrating digital twin of one manufacturing cell — it mirrors a
real machine live, computes OEE/throughput, detects bottlenecks, and lets you test
process changes virtually before making them physically.

The whole software stack is built and validated against a **hardware emulator
first**, so there is a complete, demo-able system before any real machine is
touched. Real hardware swaps in at Phase 8 with no downstream rewrite, because
everything downstream only ever sees MQTT messages.

📄 Full spec: [`RealTime_Factory_Twin_ClaudeCode_Plan.md`](RealTime_Factory_Twin_ClaudeCode_Plan.md)

---

## Status

| Phase | What | State |
|---|---|---|
| **0** | Scaffold + infra + shared contract (`services/common`) | ✅ done (dev stack; Docker path ready) |
| **1** | Edge emulator, 3 scenarios, MQTT publish | ✅ **done & verified** |
| **2** | Ingestion → historian, queryable per-station KPIs | ✅ **done & verified** |
| **3** | FastAPI + OEE/throughput/timeline KPI engine | ✅ **done & verified** |
| **4** | SimPy twin, scipy-fitted, validation ≤10% | ✅ **done — 0.47% error** |
| **5** | Self-calibration + what-if + closed loop (patent core) | ✅ **done — closed loop 1.3% error** |
| **6–7** | React dashboard + live floor view + what-if UI | ✅ **done — live over WebSocket** |
| **8** | Retrofit current→state inference + ESP32/PLC edges | ✅ **software done — 96–99.5% state acc; firmware ready** |
| 9 | Validation study on the real cell + paper/patent | ⬜ needs the physical kit |

**Verified end-to-end:** emulator → MQTT broker → ingestion → historian → KPI API →
SimPy twin (scipy-fitted). Twin predicts throughput within **0.47%** of actual, and in
the **closed-loop test the twin predicted +34% throughput from speeding up the
bottleneck; the real cell delivered +33% (error 1.3%)** — the headline novelty result.
See [`docs/validation/`](docs/validation/).

---

## Toolchain (installed into your home dir — no admin/password needed)

- **Python 3.11.16** (via [uv](https://docs.astral.sh/uv/)) → project `.venv`
- **Node v24.20.0 LTS** + npm → `~/.local` (for the Phase-6 frontend)
- `~/.local/bin` was added to your `~/.zshrc` PATH

### Broker + historian: two options

**A) Dev stack (default, zero-install, runs now):** a headless pure-Python MQTT
broker (`amqtt`, a Mosquitto stand-in) + a **SQLite historian** — the same
"stand-in now, swap the real thing in later" idea the emulator uses for hardware.
Selected automatically; nothing to install.

**B) Real stack (InfluxDB 2.x + Mosquitto via Docker):** the plan's target. This
needs **Docker**, which on macOS requires a VM and a one-time admin password (I
can't enter passwords). Colima gives you Docker headlessly:
```bash
# one-time, needs your password once (installs Homebrew, then Docker via Colima)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install colima docker docker-compose
colima start
```
Then `docker compose up -d` brings up Mosquitto + InfluxDB, and the ingestion
service auto-switches to InfluxDB (`HISTORIAN_BACKEND=auto` prefers it when
reachable). The docker CLI + compose are already downloaded to `~/.local`.

---

## Quickstart

### See the emulator immediately (no broker at all)
```bash
cd "/Users/pranavshanmugamrajesh/Desktop/digital twin"
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --dry-run --speed 20
```

### Run the full pipeline (dev stack)
```bash
scripts/dev_up.sh          # starts broker + ingestion (SQLite historian)
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --speed 20 --sim-seconds 1200
./.venv/bin/python scripts/historian_check.py      # per-station cycle times + events
scripts/dev_down.sh        # stop the stack
```

### Run the KPI API (Phase 3)
```bash
HISTORIAN_BACKEND=sqlite ./.venv/bin/uvicorn backend.app.main:app --port 8000
# then:
curl "http://127.0.0.1:8000/api/stations"
curl "http://127.0.0.1:8000/api/kpi/oee?station=S3&window=1h"
curl "http://127.0.0.1:8000/api/kpi/throughput?line=L1&window=1h"
curl "http://127.0.0.1:8000/api/timeline/S3?window=1h"
curl "http://127.0.0.1:8000/api/simulate/validate?line=L1&window=2h"   # twin vs actual
```
OEE is computed exactly per plan §6.4; run `./.venv/bin/python -m pytest backend/tests -q`
for the OEE-math + KPI-engine + twin/calibration tests (15 tests).

### Validate the twin (Phase 4)
```bash
./.venv/bin/python scripts/validate.py --line L1 --window 2h
```

### What-if, bottleneck, self-calibration, closed loop (Phase 5)
```bash
./.venv/bin/python scripts/closed_loop_demo.py       # the headline: predict a change, verify vs reality
./.venv/bin/python scripts/calibration_loop.py --once
# API (server running):
curl "http://127.0.0.1:8000/api/analyze/bottleneck?line=L1&window=2h"
curl -X POST "http://127.0.0.1:8000/api/simulate/whatif" -H 'content-type: application/json' \
  -d '{"line":"L1","window":"2h","changes":[{"type":"cycle_reduction","station":"S3","percent":25}]}'
curl -X POST "http://127.0.0.1:8000/api/calibrate?line=L1&window=15m"
curl "http://127.0.0.1:8000/api/calibrations"
```

### Watch the raw bus (optional)
```bash
./.venv/bin/python scripts/monitor.py              # pretty-prints MQTT traffic
```

---

## Emulator options
```
--scenario NAME|PATH   scenario in edge/emulator/scenarios/ or a .yaml path (default: normal)
--speed N              sim-time multiplier (real-time = 1; 10–20 is good for demos)
--dry-run              don't connect to a broker; just generate
--print                print every telemetry/event payload as JSON
--quiet                hide the per-tick status line
--sim-seconds N        stop after N simulated seconds (0 = forever)
--broker / --port      MQTT target (default localhost:1883)
--list-scenarios       list available scenarios and exit
```

## Layout
```
services/common/     the contract: MQTT topics + schemas + historian abstraction
edge/emulator/       Phase 1 emulator + scenarios
services/ingestion/  Phase 2 MQTT -> historian
services/inference/  Phase 8 current -> state, novelty #1 (stub)
backend/             Phase 3+ FastAPI: KPI, SimPy twin, what-if, websockets (stub)
frontend/            Phase 6+ React dashboard + floor view (stub)
scripts/             dev_broker, dev_up/down, monitor, historian_check, flux_check
infra/, docker-compose.yml   real Mosquitto + InfluxDB (Docker)
docs/                architecture.md, patent/novelty-log.md, validation/
```

## Data contract (why hardware — and the historian — swap in cleanly)
Topics: `factory/{line_id}/{station_id}/telemetry` and `.../event`. Payloads are
defined once in [`services/common/schemas.py`](services/common/schemas.py) and
validated at publish time. The historian lives behind one interface
([`services/common/historian.py`](services/common/historian.py)) with SQLite and
InfluxDB backends, so the KPI engine (Phase 3) doesn't care which is active.
See [`docs/architecture.md`](docs/architecture.md).

## Run the live UI (Phases 6–7)
```bash
scripts/dev_up.sh                                                   # broker + ingestion
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --speed 10   # stream
HISTORIAN_BACKEND=sqlite ./.venv/bin/uvicorn backend.app.main:app --port 8000    # API + /ws/live
cd frontend && npm install && npm run dev                          # http://localhost:5173
```
Dashboard: OEE gauge, availability/throughput/bottleneck cards, live throughput
chart, machine-state timeline, per-station utilization, recent stoppages, and a
2D floor view colored by live state (click a station to inspect). The **What-If**
tab runs the twin from the browser. If the backend isn't on :8000, start it on
another port and run the frontend with `BACKEND_PORT=<port> npm run dev`.

## Retrofit / real hardware (Phase 8)
**Route B (legacy machine):** an ESP32 + SCT-013 CT clamp + IR counter
([edge/firmware/](edge/firmware/)) publishes raw current+IR to `.../raw`;
[services/inference](services/inference/) infers state + cycle time (novelty #1)
and republishes standard telemetry — so ingestion/twin/dashboard are unchanged.
```bash
scripts/dev_up.sh
./.venv/bin/python services/inference/main.py                                  # raw -> inferred telemetry
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --raw --speed 6   # emulate an ESP32
./.venv/bin/python scripts/inference_eval.py --scenario breakdown              # accuracy vs labeled traces
```
State accuracy 96–99.5%, cycle-time error 1.5–2.0%, twin validated on inferred
data at 0.89% ([docs/validation/phase8-inference.md](docs/validation/phase8-inference.md)).
**Route A (PLC):** import [edge/node-red/flow.json](edge/node-red/flow.json) into
Node-RED and wire an OPC-UA/Modbus read node → same MQTT schema.

## Next: Phase 9 (needs the physical cell)
Instrument the real machine, run the before/after validation study on real data
(target ≤10–15%), record the demo video, and complete the patent-disclosure +
paper package. The software stack runs unchanged once real telemetry hits the broker.
