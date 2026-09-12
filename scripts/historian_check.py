#!/usr/bin/env python3
"""Prove the Phase-2 DoD against whichever historian backend is active
(SQLite now, InfluxDB once Docker is up) — same queries either way.

    ./.venv/bin/python scripts/historian_check.py [--window 1h]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.common.historian import get_historian  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", default="1h")
    args = ap.parse_args()

    h = get_historian()
    print(f"historian backend: {h.backend}   window: {args.window}\n")

    print("=== per-station mean cycle_time_s ===")
    cyc = h.station_cycle_stats(args.window)
    if cyc:
        for s, v in cyc.items():
            print(f"  {s}: {v:.2f} s")
    else:
        print("  (no cycle_time_s points yet — let the emulator run longer)")

    print("\n=== latest part_count per station ===")
    for s, v in h.latest_part_counts(args.window).items():
        print(f"  {s}: {v}")

    print("\n=== event counts (station / type) ===")
    evt = h.event_counts(args.window)
    if evt:
        for (s, t), n in evt.items():
            print(f"  {s} / {t}: {n}")
    else:
        print("  (no events yet)")

    h.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
