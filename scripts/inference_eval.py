#!/usr/bin/env python3
"""Evaluate retrofit state inference against ground truth (novelty #1, Phase 8).

The emulator emits both the raw signal (current + IR) AND the true state, so it is
a labeled trace. We feed ONLY the raw signal to the inferencer and compare its
output to the true state — measuring how well current+IR alone recover the state.

    ./.venv/bin/python scripts/inference_eval.py --scenario breakdown --seconds 3000
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "edge" / "emulator"))

from emulator import LineSimulator, load_scenario  # noqa: E402
from services.inference.inference import StateInferencer, WINDOW  # noqa: E402

STATES = ["running", "idle", "blocked", "down"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="breakdown")
    ap.add_argument("--seconds", type=int, default=3000)
    a = ap.parse_args()

    sim = LineSimulator(load_scenario(a.scenario))
    infs: dict = {}
    total = correct = 0
    warm_skipped = 0
    confusion = defaultdict(int)         # (true, pred) -> n
    cyc_err = []                         # (pred_cycle - true_cycle)

    per_sample = 0
    for _ in range(a.seconds):
        sim.advance(1.0)
        for _topic, msg in sim.telemetry_messages():
            sid = msg.station_id
            inf = infs.get(sid) or infs.setdefault(sid, StateInferencer(sid))
            pred, cyc = inf.update(sim.sim_time_s, msg.current_a, msg.part_present, msg.part_count)
            per_sample += 1
            true = msg.state.value
            # skip the initial per-station calibration window
            if len(inf.cal._buf) < WINDOW:
                warm_skipped += 1
                continue
            total += 1
            confusion[(true, pred.value)] += 1
            if pred.value == true:
                correct += 1
            if cyc is not None and msg.cycle_time_s:
                cyc_err.append(abs(cyc - msg.cycle_time_s) / msg.cycle_time_s * 100.0)
        sim.drain_events()

    acc = correct / total * 100 if total else 0.0
    print(f"scenario={a.scenario}  samples_scored={total}  (skipped {warm_skipped} during calibration)")
    print(f"OVERALL state-inference accuracy: {acc:.1f}%")

    print("\nper-true-state recall:")
    for s in STATES:
        tot = sum(confusion[(s, p)] for p in STATES)
        cor = confusion[(s, s)]
        if tot:
            print(f"  {s:8s}: {cor/tot*100:5.1f}%  (n={tot})")

    print("\nconfusion (true -> pred):")
    header = "        " + "".join(f"{p[:4]:>8}" for p in STATES)
    print(header)
    for t in STATES:
        row = "".join(f"{confusion[(t, p)]:8d}" for p in STATES)
        print(f"  {t:6s}{row}")

    if cyc_err:
        print(f"\ncycle-time inference: mean abs error {sum(cyc_err)/len(cyc_err):.1f}%  "
              f"(n={len(cyc_err)})")


if __name__ == "__main__":
    main()
