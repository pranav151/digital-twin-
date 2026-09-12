# Real-Time Factory Digital Twin — Claude Code Build Plan
### A low-cost, self-calibrating digital twin for a real manufacturing cell
**Project class:** 3rd-year EL (SDG 9) · **Team:** ME + AS + IM · **Target outcome:** working system + peer-reviewed paper + patent filing

---

## 0. How to use this file with Claude Code

This is the master spec. Feed it to Claude Code and build **phase by phase, in order** — do not skip ahead. Each phase has a **Definition of Done (DoD)**; do not start the next phase until the current DoD passes.

**Golden rule of this build:** the entire software stack is developed and validated against a **hardware emulator first** (Phase 1), so you have a complete, demo-able system *before* touching a real machine. Real hardware is swapped in at Phase 8 with zero rewrite, because everything downstream only ever sees MQTT messages.

Recommended kickoff prompt for Claude Code:
> "Read `RealTime_Factory_Twin_ClaudeCode_Plan.md`. Scaffold the repo per Section 5, then implement Phase 0 and Phase 1 only. Stop at the Phase 1 Definition of Done and show me how to run it."

---

## 1. Project vision — what we're building and why it's credible

We are building a **real-time digital twin of one manufacturing cell**: a live virtual model that mirrors a real machine/line, computes factory KPIs, detects bottlenecks, and lets you test process changes virtually before making them physically.

It deliberately fuses the three pillars the commercial giants each specialize in:

| Pillar | Commercial reference | What we replicate (student scale) |
|---|---|---|
| **Simulate** | Siemens Tecnomatix Plant Simulation | Discrete-event model of the cell (SimPy), what-if engine, bottleneck detection |
| **Monitor** | Rockwell FactoryTalk + PTC ThingWorx | Live IIoT data, OEE/throughput dashboards, machine-state timelines |
| **Visualize** | NVIDIA Omniverse | A lightweight live 2D floor view with real-time status coloring (NOT photoreal 3D) |

**The honest scope line:** we go *deep* on Simulate + Monitor (our differentiators and the parts that carry the patent), and *deliberately light* on Visualize — a 2D SVG floor plan gets ~80% of the visual impact of Omniverse for ~2% of the effort. Chasing RTX 3D would sink the project.

---

## 2. The patentable core — the innovation thesis

> ⚠️ **Patent reality (read once, act on it):** I am not a patent attorney and cannot guarantee patentability — it depends entirely on a **prior-art search** and formal examination. Before filing: search Google Patents, Espacenet, and **InPASS** (Indian patents) for the terms below, then route everything through your **college IP cell / TBI**. Treat this section as *where the novelty most likely lives*, not a promise.

A plain "digital twin" is **not** novel — it's heavily patented and published. Do not frame the patent around that. The defensible novelty of *this* build is the combination of three things that the commercial products do **not** do together for small manufacturers:

1. **Retrofit state inference** — determining machine state (running / idle / blocked / down) and true cycle time on a **legacy, un-instrumented machine** using only clamp-on current + an IR part counter, with **no PLC, no vendor integration, no machine modification.**
2. **Self-calibrating twin** — the simulation model **continuously refits its own parameters** (cycle-time distributions, downtime rates) from the live historian, so the twin auto-corrects when it drifts from reality instead of needing a manual re-model.
3. **Commodity-hardware what-if** — delivering Tecnomatix-style predictive "what-if" on a sub-₹X sensor kit + open-source stack, making it deployable by SMEs priced out of the commercial tools.

**Candidate claim shape (for the IP cell to refine):** *"A system and method for real-time digital-twin synchronization of an un-instrumented manufacturing machine, comprising retrofit current/optical state inference, and a self-calibrating discrete-event model that continuously refits process parameters from the inferred data stream."*

**What you must capture for the filing** is listed in Section 10 — start logging it from Phase 1, not at the end.

---

## 3. System architecture

```
                    ┌─────────────────────────────┐
                    │   REAL MACHINE / CELL        │   ← one station, real data
                    └───────────────┬─────────────┘
                                    │
              ┌─────────────────────┴───────────────────┐
        Route A (has PLC)                        Route B (legacy machine)
        OPC-UA / Modbus tap                      Retrofit: CT current + IR count
              └─────────────────────┬───────────────────┘
                                    │  publishes
                          ┌─────────▼──────────┐
                          │   MQTT BROKER      │   (Mosquitto)  — live bus
                          └─────────┬──────────┘
                    ┌───────────────┴───────────────┐
                    │                               │
          ┌─────────▼─────────┐          ┌──────────▼─────────┐
          │  INGESTION SVC    │          │  STATE INFERENCE   │  ← novelty #1
          │  MQTT → InfluxDB  │          │  current → state   │
          └─────────┬─────────┘          └──────────┬─────────┘
                    │                               │
              ┌─────▼───────────────────────────────▼─────┐
              │        InfluxDB  (time-series historian)   │
              └─────────────────────┬──────────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │   FastAPI BACKEND               │
                    │   • KPI engine (OEE)            │
                    │   • SimPy digital-twin model    │  ← novelty #2 (self-calibrating)
                    │   • What-if engine              │  ← novelty #3
                    │   • WebSocket live push         │
                    └───────────────┬────────────────┘
                    ┌───────────────┼────────────────┐
          ┌─────────▼───────┐ ┌─────▼────────┐ ┌─────▼──────────┐
          │ LIVE DASHBOARD  │ │ WHAT-IF PANEL│ │ LIVE FLOOR VIEW│
          │ OEE, timelines  │ │ sim controls │ │ 2D status map  │
          └─────────────────┘ └──────────────┘ └────────────────┘
```

---

## 4. Tech stack & requirements

Pin these; do a quick "is there a newer stable version" check before committing (my knowledge runs to early 2026).

| Layer | Choice | Notes |
|---|---|---|
| Edge (real) | ESP32 (Arduino/PlatformIO) | Publishes MQTT. Route A: Node-RED with OPC-UA/Modbus nodes |
| Edge (emulator) | Python script | Publishes realistic fake MQTT so you build software-first |
| Sensors (Route B) | SCT-013 CT clamp (current), IR/proximity (count) | Non-invasive, no machine mod |
| Broker | Eclipse Mosquitto | MQTT 3.1.1/5 |
| Historian | InfluxDB 2.x (OSS) | Time-series DB |
| Backend | **Python 3.11 + FastAPI + Uvicorn** | Plays to existing FastAPI experience |
| Simulation | SimPy 4 | Discrete-event; optional AnyLogic PLE for a 3D "wow" render |
| Data/ML | pandas, numpy, scipy (dist fitting) | Cycle-time distribution fitting |
| Frontend | React + Vite + Recharts | Dashboard + charts |
| Floor view | SVG (React component) | Live-colored 2D layout |
| Realtime | WebSocket (FastAPI) or MQTT-over-WS | Push live updates to UI |
| Container | Docker + docker-compose | One-command bring-up of broker+db+api |
| Repo/CI | Git + GitHub Actions (lint+test) | |

**Dev machine prerequisites:** Docker, Node 18+, Python 3.11, an MQTT client (MQTT Explorer) for debugging.

---

## 5. Repository structure

```
factory-twin/
├── README.md
├── RealTime_Factory_Twin_ClaudeCode_Plan.md   ← this file
├── docker-compose.yml                          ← mosquitto + influxdb + api
├── .env.example
├── edge/
│   ├── emulator/                # Phase 1: fake-data publisher (build first)
│   │   ├── emulator.py          # configurable cell → MQTT
│   │   └── scenarios/           # normal.yaml, bottleneck.yaml, breakdown.yaml
│   └── firmware/                # Phase 8: real ESP32 (PlatformIO)
│       └── src/main.cpp
├── services/
│   ├── ingestion/               # MQTT → InfluxDB writer
│   ├── inference/               # current → machine-state (novelty #1)
│   └── common/                  # shared schemas, mqtt topics, config
├── backend/                     # FastAPI app
│   ├── app/
│   │   ├── main.py
│   │   ├── api/                 # routers: stations, kpi, timeline, simulate
│   │   ├── kpi/                 # OEE / throughput engine
│   │   ├── twin/                # SimPy model + calibration (novelty #2, #3)
│   │   └── ws/                  # websocket live push
│   └── tests/
├── frontend/                    # React + Vite
│   └── src/
│       ├── pages/Dashboard.tsx
│       ├── pages/WhatIf.tsx
│       └── components/FloorView.tsx
├── docs/
│   ├── patent/                  # novelty log, prior-art notes (start Phase 1)
│   ├── validation/              # sim-vs-real results
│   └── architecture.md
└── scripts/                     # seed, bootstrap, demo
```

---

## 6. Data contracts (the spine — get these right first)

Everything decouples through these. Once fixed, edge (emulator OR real hardware) and backend evolve independently.

### 6.1 MQTT topics
```
factory/{line_id}/{station_id}/telemetry
factory/{line_id}/{station_id}/event
```

**telemetry payload** (published ~1 Hz):
```json
{
  "ts": "2026-02-10T09:15:03Z",
  "line_id": "L1",
  "station_id": "S3",
  "current_a": 4.7,          // Route B raw signal
  "part_present": true,      // IR sensor
  "part_count": 1042,        // cumulative
  "cycle_time_s": 86.2,      // last completed cycle
  "state": "running"         // Route A gives directly; Route B inferred later
}
```

**event payload** (published on state change / stoppage):
```json
{ "ts": "...", "line_id": "L1", "station_id": "S3",
  "event_type": "down", "reason": "jam", "duration_s": 141 }
```

### 6.2 InfluxDB schema
- **measurement `telemetry`** — tags: `line_id`, `station_id`; fields: `current_a`, `part_count`, `cycle_time_s`, `state_code` (0 idle,1 running,2 blocked,3 down)
- **measurement `events`** — tags: `line_id`, `station_id`, `event_type`; fields: `duration_s`

### 6.3 REST API (FastAPI)
```
GET  /api/stations                         → [{station_id, state, last_seen}]
GET  /api/kpi/oee?station=S3&window=8h     → {oee, availability, performance, quality}
GET  /api/kpi/throughput?line=L1&window=1h → {units_per_hr, series[]}
GET  /api/timeline/{station}?window=8h     → [{start, end, state}]
POST /api/simulate/whatif                  → body{changes[]} → {baseline, predicted, delta}
GET  /api/simulate/validate?station=S3     → {sim_throughput, real_throughput, error_pct}
WS   /ws/live                              → pushes telemetry + KPI deltas
```

### 6.4 OEE definition (implement exactly)
```
OEE        = Availability × Performance × Quality
Availability = run_time / planned_time
Performance  = (ideal_cycle_s × good_count) / run_time
Quality      = good_count / total_count
```

---

## 7. Phased build plan (with Definition of Done)

### Phase 0 — Scaffold & infra
- Init repo per Section 5; `docker-compose up` brings up Mosquitto + InfluxDB.
- `services/common` holds the topic strings + pydantic schemas from Section 6.
- **DoD:** `docker-compose up` runs; you can publish a test MQTT message and see it in MQTT Explorer; InfluxDB UI reachable.

### Phase 1 — Edge emulator (build the whole system without hardware) ★
- `edge/emulator/emulator.py`: models a configurable N-station cell, generates realistic cycle times (normal dist + occasional stoppages), publishes telemetry + events to MQTT.
- Ship 3 scenarios: `normal`, `bottleneck` (one slow station), `breakdown` (random downs).
- **DoD:** emulator streams believable data for a 4-station line; switching scenarios visibly changes the stream. **This unblocks all software work.**

### Phase 2 — Ingestion & historian
- `services/ingestion`: subscribes to MQTT, writes to InfluxDB per schema; handles reconnects.
- **DoD:** 10 min of emulator data lands in InfluxDB; a Flux query returns per-station cycle times and events.

### Phase 3 — Backend + KPI engine
- FastAPI app; implement `/api/stations`, `/api/kpi/oee`, `/api/kpi/throughput`, `/api/timeline`.
- OEE computed exactly per 6.4 from historian data.
- **DoD:** hitting the endpoints returns correct OEE/throughput for the running scenario; unit tests cover the OEE math with fixed inputs.

### Phase 4 — Digital twin (SimPy) + validation
- `backend/app/twin`: SimPy model of the cell — stations as resources, buffers as stores, cycle times sampled from **distributions fitted (scipy) to the real historian data**, not hardcoded.
- Implement `/api/simulate/validate`: run sim, compare predicted throughput to actual.
- **DoD:** sim throughput matches emulator's actual within **≤10%** on the `normal` scenario. Log the number.

### Phase 5 — Self-calibration + what-if engine ★ (patent core)
- **Calibration loop:** a scheduled job re-fits the sim's cycle-time/downtime parameters from the latest historian window and stores versioned parameter sets (prove the twin auto-tracks reality).
- **What-if:** `/api/simulate/whatif` accepts changes (`add_operator@S3`, `buffer_size`, `cycle_reduction%`) and returns predicted vs baseline KPIs.
- Auto **bottleneck detection**: the station with highest utilization / longest queue.
- **DoD:** inject a change in the emulator that mimics a what-if scenario; the twin's *prediction* matches the emulator's *new actual* within tolerance. This closed loop is your headline result and core novelty evidence.

### Phase 6 — Live dashboard (Monitor pillar)
- React dashboard: OEE gauge, throughput card, per-station utilization, **machine-state timeline** (the colored bar like the reference dashboards), issues list. Live via WebSocket.
- **DoD:** dashboard updates in real time as the emulator runs; matches the look/function of the reference screenshots.

### Phase 7 — Live floor view (Visualize pillar, lite)
- `FloorView.tsx`: SVG top-down layout of the cell; stations colored live by state (green/amber/red); click a station → its KPIs.
- **DoD:** floor view reflects live state; bottleneck station is visually obvious.

### Phase 8 — Real hardware integration (zero downstream rewrite)
- **Route B:** ESP32 firmware reads CT clamp (current) + IR counter, publishes the *same* telemetry schema. Implement `services/inference` to convert current → state (threshold/ML) and derive cycle time — **novelty #1**.
- **Route A (if machine has PLC):** Node-RED reads OPC-UA/Modbus tags → same MQTT schema.
- Point the real edge at the same broker; the entire stack works unchanged.
- **DoD:** real machine's live data drives the dashboard, twin, and floor view. Validation re-run on **real** data hits ≤10–15%.

### Phase 9 — Validation study + patent/paper package
- Run the full before/after study on the real cell; produce the validation report + demo video.
- Complete the patent documentation (Section 10) and paper draft.
- **DoD:** reproducible results, filled patent-disclosure doc, submitted paper.

---

## 8. Module specifications (key ones)

**inference (novelty #1)** — input: `current_a` stream per station. Output: `state` + `cycle_time_s`. Method: calibrate baseline (off/idle/running) current bands per machine during a short learn phase; classify live; count running→idle transitions as cycles. Start with thresholds; upgrade to a small classifier if noisy. **Log the method precisely for the patent.**

**twin/calibration (novelty #2)** — input: historian window. Output: versioned parameter set (per-station cycle-time distribution params, downtime rate). Runs on schedule; stores history so you can *show* the model tracking reality over time. This "continuous refit from inferred data" is the defensible claim.

**twin/whatif (novelty #3)** — input: list of changes; clones current calibrated model, applies changes, runs M replications, returns mean predicted KPIs + confidence. Deterministic seed option for demos.

**ws** — pushes telemetry + recomputed KPI deltas to all clients; throttle to ~1–2 Hz.

---

## 9. Testing & acceptance criteria

- **Unit:** OEE math, distribution fitting, state inference on labeled current traces.
- **Integration:** emulator → ingestion → InfluxDB → API returns correct KPIs.
- **Validation (the important one):** sim vs actual throughput error, reported for normal + bottleneck + a what-if scenario, on emulator AND real hardware.
- **The headline metric** for paper + patent + jury: *"twin predicted change X → +Y% throughput; real cell delivered +Z%, error N%."*

---

## 10. Patent documentation checklist (start Phase 1, not the end)

Keep `docs/patent/novelty-log.md` from day one. Record:
- [ ] Prior-art search results (Google Patents / Espacenet / InPASS) for: "retrofit digital twin", "self-calibrating discrete event twin", "current-based machine state inference", "low-cost OEE IoT". Note the *gap* your combination fills.
- [ ] Exact **state-inference method** (currents, thresholds/model, transition logic) — dated.
- [ ] Exact **calibration method** (what refits, from what window, how often) — dated.
- [ ] The **what-if closed-loop validation** results proving predictive accuracy.
- [ ] Block diagrams + data flow (reuse Section 3).
- [ ] First public-disclosure date awareness — **file before publishing/exhibiting** (talk to the IP cell about this; public disclosure can affect rights).
- [ ] Inventor list + contributions.

---

## 11. Team role split (ME + AS + IM)

- **IM (lead on the "why"):** process mapping, OEE/KPI definitions, simulation logic + validation design, what-if scenarios, ROI/impact framing, paper.
- **ME:** the real cell + fixturing, sensor mounting, mechanical understanding of stations/cycles, physical setup for the study.
- **AS:** ESP32 firmware, sensors, MQTT/ingestion, backend + inference, dashboard integration.

(Software backend suits whoever has the FastAPI/Python strength; the emulator lets everyone build in parallel before hardware.)

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| No real factory access | Emulator carries the full build; fall back to a campus machine or a self-run bench rig — real *measured* data is what matters |
| OPC-UA/Modbus learning curve | Prefer **Route B sensor retrofit** — simpler, and it *is* the novelty |
| Noisy current → wrong state | Short per-machine learn phase; classifier instead of fixed thresholds |
| Over-scoping (chasing 3D) | 2D floor view only; 3D is explicitly out of scope |
| Sim never matches reality | Fit distributions from real data (Phase 4); calibration loop (Phase 5) closes the gap |
| Patent disclosure timing | Coordinate filing vs paper/exhibition with the IP cell early |

---

## 13. Milestone timeline (one semester, adjust to your calendar)

| Weeks | Milestone |
|---|---|
| 1–2 | Phase 0–1: infra + emulator streaming |
| 3–4 | Phase 2–3: historian + KPI API |
| 5–6 | Phase 4: SimPy twin + first validation |
| 7–8 | Phase 5: calibration + what-if (patent core) |
| 9–10 | Phase 6–7: dashboard + floor view |
| 11 | Phase 8: real hardware integration |
| 12+ | Phase 9: validation study, patent doc, paper |

---

### First action
Secure the **host cell** (real machine you'll instrument) in parallel with Phase 0–1 — it's the long-lead item. Everything else can start today against the emulator.

*Reminder: the patent framing here points you at the likely novelty; it is not legal advice. Run the prior-art search and involve your college IP cell before filing or publicly disclosing.*
