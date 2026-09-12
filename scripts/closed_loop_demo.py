#!/usr/bin/env python3
"""Closed-loop validation — the headline novelty evidence (build plan Phase 5, §9).

    twin predicted change X -> +Y% throughput; real cell delivered +Z%, error N%.

Flow (fully in-process, no broker needed):
  1. Run the emulator on the BASELINE bottleneck cell -> historian A.
  2. Calibrate the twin from A and ask the what-if engine to predict the effect of
     "speed up the bottleneck S3 by 25%".
  3. Physically apply that change in the emulator (S3 cycle * 0.75) -> historian B,
     giving the NEW ACTUAL throughput.
  4. Compare the twin's PREDICTION to the new ACTUAL. Small error = the closed loop
     holds: the twin predicted reality before it happened.

    ./.venv/bin/python scripts/closed_loop_demo.py
"""

from __future__ import annotations

import copy
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "edge" / "emulator"))

from emulator import LineSimulator, load_scenario  # noqa: E402
from services.common.historian import SqliteHistorian  # noqa: E402
from backend.app.kpi.engine import KPIEngine  # noqa: E402

SIM_SECONDS = 5400        # 1.5 h of simulated production per run
PUBLISH_DT = 10.0         # write a sample every 10 simulated seconds
REDUCTION_PCT = 25        # what-if: speed up the bottleneck by 25%
WINDOW = "2h"


def run_to_historian(scenario, historian, sim_seconds=SIM_SECONDS, dt=PUBLISH_DT):
    sim = LineSimulator(scenario)
    for _ in range(int(sim_seconds / dt)):
        sim.advance(dt)
        for _topic, msg in sim.telemetry_messages():
            historian.write_telemetry(msg)
        for _topic, msg in sim.drain_events():
            historian.write_event(msg)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="closed_loop_"))
    base_db, fast_db = str(tmp / "baseline.sqlite"), str(tmp / "fast.sqlite")

    # 1) baseline bottleneck cell -> historian A
    baseline = load_scenario("bottleneck")
    hist_a = SqliteHistorian(base_db)
    run_to_historian(baseline, hist_a)

    eng_a = KPIEngine(hist_a)
    baseline_actual = eng_a.throughput("L1", WINDOW)["units_per_hr"]

    # 2) twin predicts the effect of speeding up S3 by 25%
    wi = eng_a.whatif("L1", WINDOW,
                      [{"type": "cycle_reduction", "station": "S3", "percent": REDUCTION_PCT}],
                      replications=12)
    twin_baseline = wi["baseline"]["units_per_hr"]
    predicted_new = wi["predicted"]["units_per_hr"]

    # 3) physically apply the change in the emulator -> historian B (new ACTUAL)
    modified = copy.deepcopy(baseline)
    for st in modified.stations:
        if st.id == "S3":
            f = 1.0 - REDUCTION_PCT / 100.0
            st.cycle_mean_s *= f
            st.cycle_std_s *= f
    hist_b = SqliteHistorian(fast_db)
    run_to_historian(modified, hist_b)
    actual_new = KPIEngine(hist_b).throughput("L1", WINDOW)["units_per_hr"]

    # 4) compare
    real_gain = (actual_new - baseline_actual) / baseline_actual * 100.0
    pred_gain = (predicted_new - baseline_actual) / baseline_actual * 100.0
    err = abs(predicted_new - actual_new) / actual_new * 100.0

    print("=" * 64)
    print(f"  CLOSED-LOOP VALIDATION  (speed up bottleneck S3 by {REDUCTION_PCT}%)")
    print("=" * 64)
    print(f"  baseline actual throughput : {baseline_actual:7.2f} units/hr")
    print(f"  twin baseline (sanity)     : {twin_baseline:7.2f} units/hr")
    print("  " + "-" * 60)
    print(f"  TWIN PREDICTED new         : {predicted_new:7.2f} units/hr  ({pred_gain:+.1f}%)")
    print(f"  REAL cell delivered new    : {actual_new:7.2f} units/hr  ({real_gain:+.1f}%)")
    print("  " + "-" * 60)
    print(f"  prediction error           : {err:5.2f} %   "
          f"{'PASS (<=10%)' if err <= 10 else 'FAIL'}")
    print("=" * 64)
    print(f'\n  Headline: twin predicted {pred_gain:+.0f}% throughput; '
          f'real cell delivered {real_gain:+.0f}%, error {err:.1f}%.')
    return 0 if err <= 10 else 1


if __name__ == "__main__":
    raise SystemExit(main())
