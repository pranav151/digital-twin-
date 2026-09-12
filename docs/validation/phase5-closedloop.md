# Phase 5 — Closed-loop validation (the headline result)

**DoD (plan §5, §9):** inject a change that mimics a what-if scenario; the twin's
*prediction* matches the emulator's *new actual* within tolerance. This closed loop
is the core novelty evidence (self-calibrating twin + commodity what-if).

> **Headline:** the twin predicted **+34%** throughput from speeding up the
> bottleneck; the real cell delivered **+33%**, error **1.3%**.

## Experiment (`scripts/closed_loop_demo.py`, 2026-09-03)
1. Run the emulator on the **baseline** bottleneck cell → historian A.
2. Calibrate the twin from A; ask the what-if engine to predict "speed up the
   bottleneck **S3 by 25%**".
3. **Physically apply** that change in the emulator (S3 cycle × 0.75) → historian B
   = the new *actual* throughput.
4. Compare prediction vs actual.

| | throughput (units/hr) | vs baseline |
|---|---|---|
| baseline actual | 63.45 | — |
| twin baseline (sanity) | 63.73 | — |
| **twin PREDICTED** new | **85.21** | **+34.3%** |
| **real cell** delivered new | **84.16** | **+32.6%** |
| **prediction error** | | **1.26 %** ✅ |

## Self-calibration tracking reality (novelty #2)
The calibration loop re-fits + versions parameters from the latest historian window.
When the cell drifts, stored versions track it:

```
 v2  S3 cycle = 41.33 s   real = 83.1 /hr
 v1  S3 cycle = 55.22 s   real = 61.4 /hr   <- twin auto-tracked S3 55s -> 41s
```

## Bottleneck detection
`GET /api/analyze/bottleneck` runs the calibrated twin and returns the highest-
utilization station — S3 in the bottleneck cell (~98% utilized).

## Reproduce
```bash
./.venv/bin/python scripts/closed_loop_demo.py          # the headline number
./.venv/bin/python scripts/calibration_loop.py --once   # one calibration version
# API:
#   POST /api/simulate/whatif   {changes:[{type:cycle_reduction,station:S3,percent:25}]}
#   GET  /api/analyze/bottleneck
#   POST /api/calibrate ; GET /api/calibrations
```

## For the paper / patent
This is the sentence for the jury (plan §9): *"twin predicted change X → +Y%
throughput; real cell delivered +Z%, error N%."* Here X = 25% faster S3,
Y = +34%, Z = +33%, N = 1.3%. Capture the same on **real hardware** in Phase 8.
