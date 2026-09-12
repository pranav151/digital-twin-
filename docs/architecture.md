# Architecture

The whole system decouples through one contract: **MQTT topics + payload
schemas** (`services/common`). Everything upstream (emulator now, real ESP32
later) and everything downstream (ingestion, KPI, twin, UI) only ever see those
messages — so real hardware swaps in at Phase 8 with zero downstream rewrite.

```
                    ┌─────────────────────────────┐
                    │   REAL MACHINE / CELL        │   ← one station, real data
                    └───────────────┬─────────────┘
                                    │
              ┌─────────────────────┴───────────────────┐
        Route A (has PLC)                        Route B (legacy machine)
        OPC-UA / Modbus tap                      Retrofit: CT current + IR count
              └─────────────────────┬───────────────────┘
                                    │  publishes  (same schema the emulator uses)
                          ┌─────────▼──────────┐
                          │   MQTT BROKER      │   (Mosquitto)  — live bus
                          └─────────┬──────────┘
                    ┌───────────────┴───────────────┐
          ┌─────────▼─────────┐          ┌──────────▼─────────┐
          │  INGESTION SVC    │          │  STATE INFERENCE   │  ← novelty #1
          │  MQTT → InfluxDB  │          │  current → state   │
          └─────────┬─────────┘          └──────────┬─────────┘
              ┌─────▼───────────────────────────────▼─────┐
              │        InfluxDB  (time-series historian)   │
              └─────────────────────┬──────────────────────┘
                    ┌───────────────▼────────────────┐
                    │   FastAPI BACKEND               │
                    │   • KPI engine (OEE)            │
                    │   • SimPy digital-twin model    │  ← novelty #2 (self-calibrating)
                    │   • What-if engine              │  ← novelty #3
                    │   • WebSocket live push         │
                    └───────────────┬────────────────┘
          ┌─────────▼───────┐ ┌─────▼────────┐ ┌─────▼──────────┐
          │ LIVE DASHBOARD  │ │ WHAT-IF PANEL│ │ LIVE FLOOR VIEW│
          │ OEE, timelines  │ │ sim controls │ │ 2D status map  │
          └─────────────────┘ └──────────────┘ └────────────────┘
```

## The contract (source of truth: `services/common/`)

**Topics** (`topics.py`)
```
factory/{line_id}/{station_id}/telemetry     # ~1 Hz
factory/{line_id}/{station_id}/event         # on every state change
```

**Payloads** (`schemas.py`, pydantic-validated at publish + ingest)
- `Telemetry`: ts, line_id, station_id, current_a, part_present, part_count,
  cycle_time_s, state ∈ {idle, running, blocked, down}
- `Event`: ts, line_id, station_id, event_type, reason, duration_s
  (duration_s = how long the *previous* state lasted → lets the timeline be
  reconstructed from events alone)

**InfluxDB mapping** (Phase 2): state stored as `state_code` 0=idle 1=running
2=blocked 3=down.

## Build order (Definition-of-Done gated — plan §7)
Phase 0 infra → **Phase 1 emulator (done)** → 2 ingestion → 3 KPI API →
4 SimPy twin + validation → 5 self-calibration + what-if (patent core) →
6 dashboard → 7 floor view → 8 real hardware → 9 validation study + paper/patent.

## Emulator internals (Phase 1)
Serial line, finite inter-station buffers, tick-based at `tick_hz`:
- **Phase A** each tick: advance processing / repair timers, roll breakdowns
  (exponential MTBF, only under load).
- **Phase B**: resolve material movement downstream→upstream so a freed buffer
  slot is visible to the feeding station the same tick (one-station advance/tick).
- States emerge, they aren't scripted: a slow station makes its upstream go
  `blocked` and its downstream go `idle` (starved) — the bottleneck signature.
- Each station emits a per-state **current** signature with noise — the synthetic
  raw signal for the Phase-8 inference novelty.
