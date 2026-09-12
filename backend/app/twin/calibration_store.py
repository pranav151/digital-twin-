"""Versioned calibration store (build plan Phase 5, novelty #2).

The self-calibration loop re-fits the twin's parameters from the latest historian
window on a schedule and appends a *versioned* parameter set here. Keeping the
history lets us SHOW the model tracking reality over time — the defensible
"continuous refit from the inferred data stream" claim.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from .calibration import LineParams, fit_line_params


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class ParamStore:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        with self._lock, self._db:
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS calibrations (
                    version INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT, line_id TEXT, window TEXT,
                    real_units_per_hr REAL, params_json TEXT)"""
            )

    def add(self, params: LineParams) -> int:
        with self._lock, self._db:
            cur = self._db.execute(
                "INSERT INTO calibrations (ts, line_id, window, real_units_per_hr, params_json)"
                " VALUES (?,?,?,?,?)",
                (_now_iso(), params.line_id, params.window,
                 params.real_units_per_hr, json.dumps(params.as_dict())),
            )
            return int(cur.lastrowid)

    def _summ(self, row) -> dict:
        params = json.loads(row[5])
        return {
            "version": row[0], "ts": row[1], "line_id": row[2], "window": row[3],
            "real_units_per_hr": row[4],
            "station_cycle_means": {s["station_id"]: round(s["loc"], 2)
                                    for s in params["stations"]},
            "downtime_frac": {s["station_id"]: s["downtime_frac"]
                              for s in params["stations"]},
        }

    def list(self, line: Optional[str] = None, limit: int = 50) -> List[dict]:
        q = "SELECT version, ts, line_id, window, real_units_per_hr, params_json FROM calibrations"
        args = []
        if line:
            q += " WHERE line_id = ?"
            args.append(line)
        q += " ORDER BY version DESC LIMIT ?"
        args.append(limit)
        return [self._summ(r) for r in self._db.execute(q, args).fetchall()]

    def latest(self, line: Optional[str] = None) -> Optional[dict]:
        rows = self.list(line, limit=1)
        return rows[0] if rows else None

    def get_params(self, version: int) -> Optional[LineParams]:
        row = self._db.execute(
            "SELECT params_json FROM calibrations WHERE version=?", (version,)
        ).fetchone()
        return json.loads(row[0]) if row else None

    def close(self):
        with self._lock:
            self._db.close()


def default_store_path() -> str:
    import os
    repo_root = Path(__file__).resolve().parents[3]
    return os.getenv("CALIB_STORE_PATH", str(repo_root / "data" / "calibrations.sqlite"))


def calibrate_and_store(engine, store: ParamStore, line: str = "L1",
                        window: str = "1h", buffer_capacity: int = 3) -> dict:
    """Fit params from the latest historian window and append a version."""
    params = fit_line_params(engine, line, window, buffer_capacity)
    version = store.add(params)
    return {"version": version, "ts": _now_iso(), "line_id": line, "window": window,
            "real_units_per_hr": params.real_units_per_hr,
            "station_cycle_means": {s.station_id: round(s.loc, 2) for s in params.stations}}
