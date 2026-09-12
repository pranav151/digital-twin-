# Phase 8 — Retrofit state inference (novelty #1)

**DoD (plan §7):** real machine's live data drives the dashboard, twin, and floor view;
validation re-run on inferred/real data hits ≤10–15%.

On this machine there is no physical ESP32, so the method is validated in software
against **labeled traces**: the emulator emits both the raw signal (current + IR) AND
the true state, and only the raw signal is fed to the inferencer. The real firmware
(`edge/firmware/`) publishes the same raw schema, so nothing changes on hardware.

## State-inference accuracy (`scripts/inference_eval.py`, 3000 s/scenario)

| Scenario | Overall | running | idle | blocked | down |
|---|---|---|---|---|---|
| normal | **99.5%** | 99.8% | (rare) | — | — |
| bottleneck | **96.1%** | 96.2% | 95.7% | 95.8% | — |
| breakdown | **96.1%** | 98.2% | 96.9% | 96.0% | 85.5% |

`down` is the hardest state — its current band (≈0) overlaps idle/blocked under CT
noise. This is the documented case for the classifier upgrade (plan §12); thresholds
already reach ~85% recall on it.

## Cycle-time inference
Derived from **running-time accrued per part** (not wall time between completions), so
blocking/starving gaps don't inflate it: **mean abs error 1.5–2.0%** across all three
scenarios.

## Full Route-B closed loop (raw → inference → historian → twin)
Streaming raw current+IR through `services/inference` into the historian, then fitting
the twin from the **inferred** data:

- fitted cycles recovered: S1 29.5, S2 30.9, **S3 54.4** (bottleneck), S4 31.3 s
- automatic bottleneck detection: **S3** (util 0.91)
- **twin validated on inferred data: 0.89% throughput error** (≤15% DoD)

So retrofit-derived data drives the KPI engine, twin, and dashboard identically to a
PLC/emulator source.

## Reproduce
```bash
scripts/dev_up.sh
./.venv/bin/python services/inference/main.py &                       # raw -> telemetry
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --raw --speed 6 --sim-seconds 900
./.venv/bin/python scripts/inference_eval.py --scenario breakdown     # labeled-trace accuracy
```

## Note on sampling rate
A real ESP32 samples ~1 Hz; the eval uses 1 Hz. At very high `--speed` the raw stream is
coarse (30 s/sample) and short states (blocked) get debounced away — a sampling artifact,
not a method limitation. Run the retrofit demo near real time (low `--speed`).
