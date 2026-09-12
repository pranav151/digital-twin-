#!/usr/bin/env python3
"""Self-calibration loop (build plan Phase 5, novelty #2).

Periodically re-fits the twin's parameters from the LATEST historian window and
stores a versioned snapshot, so the model continuously tracks reality and drift
is visible over time (query GET /api/calibrations or scripts below).

    ./.venv/bin/python scripts/calibration_loop.py --interval 60 --window 15m
    ./.venv/bin/python scripts/calibration_loop.py --once
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.common.historian import get_historian  # noqa: E402
from backend.app.kpi.engine import KPIEngine  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--line", default="L1")
    ap.add_argument("--window", default="15m")
    ap.add_argument("--interval", type=float, default=60.0, help="seconds between refits")
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()

    eng = KPIEngine(get_historian())
    print(f"[calibration-loop] backend={eng.h.backend} line={a.line} "
          f"window={a.window} interval={a.interval}s")
    while True:
        try:
            r = eng.calibrate(a.line, a.window)
            print(f"[calibrate] v{r['version']} {r['ts']} "
                  f"means={r['station_cycle_means']} real={r['real_units_per_hr']:.1f}/hr")
        except Exception as exc:  # noqa: BLE001
            print("[calibrate] error:", exc)
        if a.once:
            break
        time.sleep(a.interval)


if __name__ == "__main__":
    main()
