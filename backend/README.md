# Backend — FastAPI (Phases 3–5)

Reads/writes through the historian interface (SQLite dev now, InfluxDB later).

## Endpoints
    GET  /api/health
    GET  /api/stations
    GET  /api/kpi/oee?station=S3&window=8h
    GET  /api/kpi/throughput?line=L1&window=1h
    GET  /api/timeline/{station}?window=8h
    GET  /api/simulate/validate?line=L1&window=8h          # twin vs actual (Phase 4)
    POST /api/simulate/whatif   {line,window,changes[]}     # predicted vs baseline (Phase 5)
    GET  /api/analyze/bottleneck?line=L1&window=8h          # highest-utilization station
    POST /api/calibrate?line=L1&window=15m                  # store a versioned param set
    GET  /api/calibrations?line=L1                          # list versions (drift over time)

## Layout
    app/kpi/oee.py          pure OEE math (plan §6.4), unit-tested
    app/kpi/engine.py       KPI engine (state durations from the event stream)
    app/twin/calibration.py scipy fit of cycle-time dists + MTBF/MTTR
    app/twin/model.py       SimPy discrete-event twin
    app/twin/whatif.py      what-if changes + bottleneck detection
    app/twin/calibration_store.py  versioned self-calibration store

Run:   ./.venv/bin/uvicorn backend.app.main:app --reload --port 8000
Tests: ./.venv/bin/python -m pytest backend/tests -q
