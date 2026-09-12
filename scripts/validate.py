#!/usr/bin/env python3
"""Fit the twin to the historian and compare sim vs real throughput (Phase 4).

    ./.venv/bin/python scripts/validate.py --line L1 --window 2h
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.common.historian import get_historian
from backend.app.kpi.engine import KPIEngine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--line", default="L1")
    ap.add_argument("--window", default="2h")
    ap.add_argument("--replications", type=int, default=10)
    ap.add_argument("--buffer", type=int, default=3)
    a = ap.parse_args()
    eng = KPIEngine(get_historian())
    r = eng.validate(a.line, a.window, a.replications, a.buffer)
    print(f"backend: {eng.h.backend}")
    print(f"real: {r['real_throughput_units_per_hr']} u/hr   "
          f"sim: {r['sim_throughput_units_per_hr']} ±{r['sim']['units_per_hr_std']} u/hr")
    print(f"error: {r['error_pct']}%   within 10%: {r['within_10pct']}")
    print("utilization:", json.dumps(r["sim"]["per_station_utilization"]))


if __name__ == "__main__":
    main()
