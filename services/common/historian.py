"""Historian abstraction — the time-series store behind one interface.

The build plan specifies InfluxDB 2.x. On this machine InfluxDB has no native
arm64 build and Docker isn't up yet, so we ship two interchangeable backends:

  * SqliteHistorian  — zero-install local file; the dev default, works now.
  * InfluxHistorian  — the real InfluxDB 2.x + Flux backend (plan §6.2), used
                       automatically once InfluxDB is reachable (e.g. via Docker).

Everything downstream (ingestion now, the KPI engine in Phase 3) talks to this
interface, so swapping SQLite -> InfluxDB is a config flip, not a rewrite —
exactly how the emulator stands in for real hardware.

Select with env HISTORIAN_BACKEND = auto | sqlite | influx  (default: auto).
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Tuple

from .config import get_settings
from .schemas import Event, Telemetry, state_code

_WINDOW_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([smhd])\s*$")
_UNIT_S = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def parse_window(window) -> float:
    """'1h' / '30m' / '600s' / '1d' / number-of-seconds -> seconds (float)."""
    if isinstance(window, (int, float)):
        return float(window)
    m = _WINDOW_RE.match(str(window))
    if not m:
        raise ValueError(f"bad window: {window!r} (use e.g. 1h, 30m, 600s, 1d)")
    return float(m.group(1)) * _UNIT_S[m.group(2)]


def ts_to_epoch(ts: str) -> float:
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _now_epoch() -> float:
    return datetime.now(timezone.utc).timestamp()


class Historian(ABC):
    backend: str = "?"

    @abstractmethod
    def write_telemetry(self, t: Telemetry) -> None: ...

    @abstractmethod
    def write_event(self, e: Event) -> None: ...

    @abstractmethod
    def station_cycle_stats(self, window="1h") -> Dict[str, float]: ...

    @abstractmethod
    def latest_part_counts(self, window="1h") -> Dict[str, int]: ...

    @abstractmethod
    def event_counts(self, window="1h") -> Dict[Tuple[str, str], int]: ...

    # -- raw accessors for the KPI engine (Phase 3) ------------------------ #
    @abstractmethod
    def latest_states(self) -> Dict[str, Tuple[int, str]]:
        """station_id -> (state_code, ts_iso) for the most recent sample."""

    @abstractmethod
    def telemetry_rows(self, window="8h", station=None) -> "list[dict]":
        """Ordered (asc) telemetry rows in a DATA-relative window: keys
        ts_epoch, ts, line_id, station_id, current_a, part_present,
        part_count, cycle_time_s, state_code."""

    @abstractmethod
    def event_rows(self, window="8h", station=None) -> "list[dict]":
        """Ordered (asc) event rows: ts_epoch, ts, line_id, station_id,
        event_type, duration_s, reason."""

    def flush(self) -> None:
        pass

    def prune(self, retention_s: float) -> int:
        """Delete rows older than `retention_s` before the newest sample so the
        working set stays bounded. Default no-op; overridden where supported."""
        return 0

    def close(self) -> None:
        pass


# --------------------------------------------------------------------------- #
# SQLite backend (dev default)
# --------------------------------------------------------------------------- #
class SqliteHistorian(Historian):
    backend = "sqlite"

    def __init__(self, path: str):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    def _init_schema(self):
        with self._lock, self._db:
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS telemetry (
                    ts_epoch REAL, ts TEXT, line_id TEXT, station_id TEXT,
                    current_a REAL, part_present INTEGER, part_count INTEGER,
                    cycle_time_s REAL, state_code INTEGER)"""
            )
            self._db.execute(
                """CREATE TABLE IF NOT EXISTS events (
                    ts_epoch REAL, ts TEXT, line_id TEXT, station_id TEXT,
                    event_type TEXT, duration_s REAL, reason TEXT)"""
            )
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS ix_tele ON telemetry(station_id, ts_epoch)"
            )
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS ix_evt ON events(station_id, ts_epoch)"
            )
            # Global time-ordered indexes. The composite indexes above lead with
            # station_id, so `MAX(ts_epoch)` and any station-agnostic window scan
            # (e.g. line throughput) would otherwise full-scan the whole table —
            # the cause of the event-loop stall as history grows. These fix that.
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS ix_tele_ts ON telemetry(ts_epoch)"
            )
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS ix_evt_ts ON events(ts_epoch)"
            )

    def write_telemetry(self, t: Telemetry) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO telemetry VALUES (?,?,?,?,?,?,?,?,?)",
                (ts_to_epoch(t.ts), t.ts, t.line_id, t.station_id, float(t.current_a),
                 int(t.part_present), int(t.part_count),
                 None if t.cycle_time_s is None else float(t.cycle_time_s),
                 int(state_code(t.state))),
            )

    def write_event(self, e: Event) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO events VALUES (?,?,?,?,?,?,?)",
                (ts_to_epoch(e.ts), e.ts, e.line_id, e.station_id,
                 e.event_type.value, float(e.duration_s or 0.0), e.reason or ""),
            )

    def prune(self, retention_s: float) -> int:
        """Delete telemetry/events older than `retention_s` before the newest
        sample. Keeps windowed KPI queries fast by bounding the working set.
        Call only from the sole writer (ingestion) to avoid multi-writer locks.
        Returns telemetry rows deleted."""
        if retention_s <= 0:
            return 0
        with self._lock, self._db:
            row = self._db.execute("SELECT MAX(ts_epoch) FROM telemetry").fetchone()
            end = row[0] if row else None
            if end is None:
                return 0
            cutoff = end - retention_s
            n = self._db.execute(
                "DELETE FROM telemetry WHERE ts_epoch < ?", (cutoff,)
            ).rowcount
            self._db.execute("DELETE FROM events WHERE ts_epoch < ?", (cutoff,))
        return int(n or 0)

    def _cutoff(self, window) -> float:
        return _now_epoch() - parse_window(window)

    def station_cycle_stats(self, window="1h") -> Dict[str, float]:
        cur = self._db.execute(
            """SELECT station_id, AVG(cycle_time_s) FROM telemetry
               WHERE ts_epoch >= ? AND cycle_time_s IS NOT NULL
               GROUP BY station_id ORDER BY station_id""",
            (self._cutoff(window),),
        )
        return {row[0]: float(row[1]) for row in cur.fetchall()}

    def latest_part_counts(self, window="1h") -> Dict[str, int]:
        cur = self._db.execute(
            """SELECT station_id, MAX(part_count) FROM telemetry
               WHERE ts_epoch >= ? GROUP BY station_id ORDER BY station_id""",
            (self._cutoff(window),),
        )
        return {row[0]: int(row[1]) for row in cur.fetchall()}

    def event_counts(self, window="1h") -> Dict[Tuple[str, str], int]:
        cur = self._db.execute(
            """SELECT station_id, event_type, COUNT(*) FROM events
               WHERE ts_epoch >= ? GROUP BY station_id, event_type
               ORDER BY station_id, event_type""",
            (self._cutoff(window),),
        )
        return {(row[0], row[1]): int(row[2]) for row in cur.fetchall()}

    # -- raw accessors ----------------------------------------------------- #
    def _end_epoch(self) -> float:
        row = self._db.execute("SELECT MAX(ts_epoch) FROM telemetry").fetchone()
        return row[0] if row and row[0] is not None else _now_epoch()

    _TELE_COLS = ["ts_epoch", "ts", "line_id", "station_id", "current_a",
                  "part_present", "part_count", "cycle_time_s", "state_code"]
    _EVT_COLS = ["ts_epoch", "ts", "line_id", "station_id",
                 "event_type", "duration_s", "reason"]

    def latest_states(self) -> Dict[str, Tuple[int, str]]:
        cur = self._db.execute(
            """SELECT t.station_id, t.state_code, t.ts FROM telemetry t
               JOIN (SELECT station_id, MAX(ts_epoch) mx FROM telemetry GROUP BY station_id) m
                 ON t.station_id = m.station_id AND t.ts_epoch = m.mx
               ORDER BY t.station_id"""
        )
        return {row[0]: (int(row[1]), row[2]) for row in cur.fetchall()}

    def telemetry_rows(self, window="8h", station=None) -> "list[dict]":
        start = self._end_epoch() - parse_window(window)
        q = (f"SELECT {','.join(self._TELE_COLS)} FROM telemetry "
             "WHERE ts_epoch >= ?")
        args = [start]
        if station:
            q += " AND station_id = ?"
            args.append(station)
        q += " ORDER BY ts_epoch ASC"
        return [dict(zip(self._TELE_COLS, r)) for r in self._db.execute(q, args)]

    def event_rows(self, window="8h", station=None) -> "list[dict]":
        start = self._end_epoch() - parse_window(window)
        q = (f"SELECT {','.join(self._EVT_COLS)} FROM events "
             "WHERE ts_epoch >= ?")
        args = [start]
        if station:
            q += " AND station_id = ?"
            args.append(station)
        q += " ORDER BY ts_epoch ASC"
        return [dict(zip(self._EVT_COLS, r)) for r in self._db.execute(q, args)]

    def close(self) -> None:
        with self._lock:
            self._db.close()


# --------------------------------------------------------------------------- #
# InfluxDB backend (the plan's real historian; used when reachable)
# --------------------------------------------------------------------------- #
class InfluxHistorian(Historian):
    backend = "influx"

    def __init__(self, cfg=None):
        from influxdb_client import InfluxDBClient
        from influxdb_client.client.write_api import SYNCHRONOUS

        self.cfg = cfg or get_settings()
        self._client = InfluxDBClient(
            url=self.cfg.influx_url, token=self.cfg.influx_token, org=self.cfg.influx_org
        )
        self._write = self._client.write_api(write_options=SYNCHRONOUS)
        self._q = self._client.query_api()
        self._bucket = self.cfg.influx_bucket

    @staticmethod
    def reachable(cfg=None) -> bool:
        try:
            from influxdb_client import InfluxDBClient

            cfg = cfg or get_settings()
            c = InfluxDBClient(url=cfg.influx_url, token=cfg.influx_token,
                               org=cfg.influx_org, timeout=2000)
            ok = c.ping()
            c.close()
            return bool(ok)
        except Exception:  # noqa: BLE001
            return False

    def write_telemetry(self, t: Telemetry) -> None:
        from influxdb_client import Point, WritePrecision

        p = (Point("telemetry").tag("line_id", t.line_id).tag("station_id", t.station_id)
             .field("current_a", float(t.current_a))
             .field("part_present", int(t.part_present))
             .field("part_count", int(t.part_count))
             .field("state_code", int(state_code(t.state)))
             .time(ts_to_epoch_ns(t.ts), WritePrecision.NS))
        if t.cycle_time_s is not None:
            p = p.field("cycle_time_s", float(t.cycle_time_s))
        self._write.write(bucket=self._bucket, record=p)

    def write_event(self, e: Event) -> None:
        from influxdb_client import Point, WritePrecision

        p = (Point("events").tag("line_id", e.line_id).tag("station_id", e.station_id)
             .tag("event_type", e.event_type.value)
             .field("duration_s", float(e.duration_s or 0.0))
             .field("reason", e.reason or "")
             .time(ts_to_epoch_ns(e.ts), WritePrecision.NS))
        self._write.write(bucket=self._bucket, record=p)

    def _range(self, window) -> str:
        return f"-{int(parse_window(window))}s"

    def station_cycle_stats(self, window="1h") -> Dict[str, float]:
        flux = f'''from(bucket:"{self._bucket}") |> range(start:{self._range(window)})
  |> filter(fn:(r)=>r._measurement=="telemetry" and r._field=="cycle_time_s")
  |> group(columns:["station_id"]) |> mean()'''
        out = {}
        for tbl in self._q.query(flux):
            for r in tbl.records:
                out[r.values.get("station_id")] = float(r.get_value())
        return out

    def latest_part_counts(self, window="1h") -> Dict[str, int]:
        flux = f'''from(bucket:"{self._bucket}") |> range(start:{self._range(window)})
  |> filter(fn:(r)=>r._measurement=="telemetry" and r._field=="part_count")
  |> group(columns:["station_id"]) |> last()'''
        out = {}
        for tbl in self._q.query(flux):
            for r in tbl.records:
                out[r.values.get("station_id")] = int(r.get_value())
        return out

    def event_counts(self, window="1h") -> Dict[Tuple[str, str], int]:
        flux = f'''from(bucket:"{self._bucket}") |> range(start:{self._range(window)})
  |> filter(fn:(r)=>r._measurement=="events" and r._field=="duration_s")
  |> group(columns:["station_id","event_type"]) |> count()'''
        out = {}
        for tbl in self._q.query(flux):
            for r in tbl.records:
                out[(r.values.get("station_id"), r.values.get("event_type"))] = int(r.get_value())
        return out

    # -- raw accessors (Flux pivot) --------------------------------------- #
    def latest_states(self) -> Dict[str, Tuple[int, str]]:
        flux = f'''from(bucket:"{self._bucket}") |> range(start:-30d)
  |> filter(fn:(r)=>r._measurement=="telemetry" and r._field=="state_code")
  |> group(columns:["station_id"]) |> last()'''
        out = {}
        for tbl in self._q.query(flux):
            for r in tbl.records:
                out[r.values.get("station_id")] = (
                    int(r.get_value()), r.get_time().isoformat().replace("+00:00", "Z")
                )
        return out

    def _pivot_rows(self, measurement, window, station):
        sfilter = f' and r.station_id=="{station}"' if station else ""
        flux = f'''from(bucket:"{self._bucket}") |> range(start:-{int(parse_window(window))}s)
  |> filter(fn:(r)=>r._measurement=="{measurement}"{sfilter})
  |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
  |> sort(columns:["_time"])'''
        rows = []
        for tbl in self._q.query(flux):
            for r in tbl.records:
                v = dict(r.values)
                t = r.get_time()
                v["ts_epoch"] = t.timestamp()
                v["ts"] = t.isoformat().replace("+00:00", "Z")
                rows.append(v)
        return rows

    def telemetry_rows(self, window="8h", station=None) -> "list[dict]":
        return self._pivot_rows("telemetry", window, station)

    def event_rows(self, window="8h", station=None) -> "list[dict]":
        return self._pivot_rows("events", window, station)

    def close(self) -> None:
        self._client.close()


def ts_to_epoch_ns(ts: str) -> int:
    return int(ts_to_epoch(ts) * 1_000_000_000)


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #
def default_sqlite_path() -> str:
    repo_root = Path(__file__).resolve().parents[2]
    return os.getenv("SQLITE_PATH", str(repo_root / "data" / "historian.sqlite"))


def get_historian() -> Historian:
    """Pick a backend from HISTORIAN_BACKEND (auto|sqlite|influx)."""
    choice = os.getenv("HISTORIAN_BACKEND", "auto").lower()
    if choice == "influx":
        return InfluxHistorian()
    if choice == "sqlite":
        return SqliteHistorian(default_sqlite_path())
    # auto: prefer the real historian if it's up, else the dev store
    if InfluxHistorian.reachable():
        return InfluxHistorian()
    return SqliteHistorian(default_sqlite_path())
