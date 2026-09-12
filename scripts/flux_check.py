#!/usr/bin/env python3
"""Prove the Phase-2 DoD: query InfluxDB with Flux and show that per-station
cycle times and events landed.

    ./.venv/bin/python scripts/flux_check.py [--window 1h]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from influxdb_client import InfluxDBClient

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
from services.common.config import get_settings  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--window", default="1h", help="Flux range start, e.g. 1h, 30m, 8h")
    args = ap.parse_args()
    cfg = get_settings()

    client = InfluxDBClient(url=cfg.influx_url, token=cfg.influx_token, org=cfg.influx_org)
    q = client.query_api()

    print(f"InfluxDB {cfg.influx_url}  bucket={cfg.influx_bucket}  window=-{args.window}\n")

    # 1) per-station cycle-time stats
    flux_cycle = f'''
from(bucket: "{cfg.influx_bucket}")
  |> range(start: -{args.window})
  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "cycle_time_s")
  |> group(columns: ["station_id"])
  |> mean()
'''
    print("=== per-station mean cycle_time_s ===")
    tables = q.query(flux_cycle)
    rows = 0
    for t in tables:
        for r in t.records:
            rows += 1
            print(f"  {r.values.get('station_id')}: mean cycle = {r.get_value():.2f} s")
    if not rows:
        print("  (no cycle_time_s points yet — let the emulator run a bit longer)")

    # 2) latest part_count per station
    flux_count = f'''
from(bucket: "{cfg.influx_bucket}")
  |> range(start: -{args.window})
  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "part_count")
  |> group(columns: ["station_id"])
  |> last()
'''
    print("\n=== latest part_count per station ===")
    for t in q.query(flux_count):
        for r in t.records:
            print(f"  {r.values.get('station_id')}: part_count = {int(r.get_value())}")

    # 3) event counts by station + type
    flux_events = f'''
from(bucket: "{cfg.influx_bucket}")
  |> range(start: -{args.window})
  |> filter(fn: (r) => r._measurement == "events" and r._field == "duration_s")
  |> group(columns: ["station_id", "event_type"])
  |> count()
'''
    print("\n=== event counts (station / type) ===")
    any_evt = False
    for t in q.query(flux_events):
        for r in t.records:
            any_evt = True
            print(f"  {r.values.get('station_id')} / {r.values.get('event_type')}: "
                  f"{int(r.get_value())}")
    if not any_evt:
        print("  (no events yet)")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
