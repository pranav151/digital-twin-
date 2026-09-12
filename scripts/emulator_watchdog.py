#!/usr/bin/env python3
"""Emulator watchdog — keeps the live data flowing across laptop sleeps.

The emulator stamps wall-clock timestamps (so real MTConnect + sim share a time
base). When the machine sleeps, the emulator process can freeze — it stays alive
but stops advancing, so its telemetry timestamps go stale and the KPI window
empties out (OEE reads 0). This watchdog notices that and restarts it.

    ./.venv/bin/python scripts/emulator_watchdog.py --scenario fullplant --speed 1

Run it in the background alongside the stack; it checks every CHECK_S seconds and
restarts the emulator if the newest SIM telemetry is older than STALE_S.
"""
from __future__ import annotations

import argparse
import datetime
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))
from services.common.historian import default_sqlite_path  # noqa: E402
import sqlite3  # noqa: E402

CHECK_S = 30       # how often to check
STALE_S = 90       # sim telemetry older than this (wall clock) => frozen
SIM_STATION = "S3"  # a station the emulator drives (not a real MTConnect one)


def newest_sim_ts(db_path: str):
    try:
        db = sqlite3.connect(db_path)
        row = db.execute("SELECT max(ts) FROM telemetry WHERE station_id=?", (SIM_STATION,)).fetchone()
        db.close()
        if not row or not row[0]:
            return None
        return datetime.datetime.fromisoformat(row[0].replace("Z", "+00:00"))
    except Exception as exc:  # noqa: BLE001
        print(f"[watchdog] historian read failed: {exc}", flush=True)
        return None


def start_emulator(args) -> subprocess.Popen:
    cmd = [str(REPO / ".venv/bin/python"), str(REPO / "edge/emulator/emulator.py"),
           "--scenario", args.scenario, "--broker", args.broker, "--port", str(args.port),
           "--speed", str(args.speed), "--quiet"]
    log = open(REPO / "data/emulator.log", "a")
    p = subprocess.Popen(cmd, stdout=log, stderr=log)
    (REPO / "data/emulator.pid").write_text(str(p.pid))
    print(f"[watchdog] started emulator pid {p.pid} ({args.scenario} @ speed {args.speed})", flush=True)
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="fullplant")
    ap.add_argument("--broker", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--adopt", action="store_true", help="assume an emulator is already running; only restart on stale")
    args = ap.parse_args()

    db_path = os.getenv("SQLITE_PATH", default_sqlite_path())
    proc = None if args.adopt else start_emulator(args)
    print(f"[watchdog] watching {SIM_STATION}; restart if telemetry > {STALE_S}s stale", flush=True)

    while True:
        time.sleep(CHECK_S)
        now = datetime.datetime.now(datetime.timezone.utc)
        ts = newest_sim_ts(db_path)
        age = (now - ts).total_seconds() if ts else 1e9
        if age > STALE_S:
            print(f"[watchdog] sim telemetry stale ({age:.0f}s) — restarting emulator", flush=True)
            try:
                pidf = REPO / "data/emulator.pid"
                if pidf.exists():
                    old = int(pidf.read_text().strip())
                    os.kill(old, 15)
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1.5)
            proc = start_emulator(args)


if __name__ == "__main__":
    main()
