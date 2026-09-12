# State inference — Phase 8 · NOVELTY #1

Converts retrofit signals (clamp-on CT current + IR part counter) into machine
state (running/idle/blocked/down) + true cycle time, for a legacy un-instrumented
machine — no PLC, no machine modification.

- `inference.py` — the method: self-calibrating current bands (1-D 2-means, robust
  to class imbalance), current+IR classification with debounce, and cycle time from
  accrued running-time per part. This file is the patent method-of-record.
- `main.py` — the service: subscribes `factory/+/+/raw`, republishes full
  `.../telemetry` + state-change `.../event`, so ingestion/twin/dashboard are unchanged.

## Run (Route B)
```bash
scripts/dev_up.sh                                   # broker + ingestion
./.venv/bin/python services/inference/main.py       # raw -> inferred telemetry
# a retrofit ESP32 publishes raw; emulate one with:
./.venv/bin/python edge/emulator/emulator.py --scenario bottleneck --raw --speed 6
```

## Accuracy (vs labeled traces)
State 96–99.5%, cycle-time error 1.5–2.0%, twin validated on inferred data at 0.89%.
See `docs/validation/phase8-inference.md`. Evaluate: `scripts/inference_eval.py`.
