# Phase 4 — Twin validation (sim vs actual throughput)

**DoD (plan §7):** sim throughput matches the emulator's actual within **≤10%** on
the `normal` scenario. Log the number.

The twin's cycle-time distributions are **fitted with scipy** to the historian
data (not hardcoded); reliability (MTBF/MTTR) is estimated from the reconstructed
state timeline. Throughput is the terminal-station output; the twin runs from
empty over the same span as the observed data, averaged over replications.

## Results (2026-09-03, SQLite dev historian, 1.5 h simulated per scenario, 10 replications)

| Scenario | Real (units/hr) | Sim (units/hr) | Error | ≤10% |
|---|---|---|---|---|
| **normal** | 115.28 | 115.82 ± 0.73 | **0.47 %** | ✅ |
| **bottleneck** | 64.05 | 64.32 ± 0.33 | **0.42 %** | ✅ |

Fitted cycle means: normal ≈ 30 s across S1–S4; bottleneck S3 ≈ 54.9 s vs ~30 s
elsewhere (correctly recovered).

**Twin reproduces the bottleneck signature** — simulated per-station utilization:

| | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| normal | 1.00 | 0.99 | 0.97 | 0.98 |
| bottleneck | 0.58 | 0.56 | **0.98** | 0.54 |

S3 is saturated (~98 %) while its neighbours idle — the constraint the what-if
engine (Phase 5) will target for bottleneck detection.

## Reproduce
```bash
scripts/dev_up.sh
./.venv/bin/python edge/emulator/emulator.py --scenario normal --speed 60 --sim-seconds 5400
scripts/dev_down.sh
./.venv/bin/python scripts/validate.py --line L1 --window 2h
```

## Note on the emulator time step
The emulator advances its physics in fine internal steps (1 s) decoupled from the
`--speed` publish cadence, so throughput/cycle timing are identical at any speed.
Without this, a coarse step (e.g. `--speed 60` → 60 s/step) quantizes part
completions and understates throughput — which would corrupt this comparison.
