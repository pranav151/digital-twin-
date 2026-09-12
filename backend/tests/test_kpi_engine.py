"""KPI engine + API tests against a hand-seeded historian with KNOWN answers.

Timeline for S1 over a 100 s span:
    [0,60)  running   -> 60 s
    [60,80) down      -> 20 s   (breakdown)
    [80,100) running  -> 20 s
  run_time = 80,  planned = 100,  good = 8 parts,  fastest cycle = 10 s
  => Availability 0.8, Performance (10*8)/80 = 1.0, Quality 1.0, OEE 0.8
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app.kpi.engine import KPIEngine
from backend.app.main import create_app
from services.common.historian import SqliteHistorian
from services.common.schemas import Event, EventType, MachineState, Telemetry

BASE = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


def _iso(offset_s: int) -> str:
    return (BASE + timedelta(seconds=offset_s)).isoformat(timespec="seconds").replace("+00:00", "Z")


@pytest.fixture()
def engine(tmp_path):
    h = SqliteHistorian(str(tmp_path / "t.sqlite"))
    tele = [  # (offset, state, part_count, cycle_time_s)
        (0, MachineState.running, 0, None),
        (20, MachineState.running, 2, 10.0),
        (40, MachineState.running, 4, 10.0),
        (60, MachineState.down, 6, 10.0),
        (80, MachineState.running, 6, None),
        (100, MachineState.running, 8, 10.0),
    ]
    for off, st, cnt, cyc in tele:
        h.write_telemetry(Telemetry(ts=_iso(off), line_id="L1", station_id="S1",
                                     current_a=4.5, part_present=True, part_count=cnt,
                                     cycle_time_s=cyc, state=st))
    # transitions: entered 'down' at 60 (running lasted 60); entered 'running' at 80 (down lasted 20)
    h.write_event(Event(ts=_iso(60), line_id="L1", station_id="S1",
                        event_type=EventType.down, reason="breakdown", duration_s=60))
    h.write_event(Event(ts=_iso(80), line_id="L1", station_id="S1",
                        event_type=EventType.running, reason="repaired", duration_s=20))
    return KPIEngine(h)


def test_oee_known_values(engine):
    r = engine.oee("S1", window="1h")
    assert r["availability"] == pytest.approx(0.8)
    assert r["performance"] == pytest.approx(1.0)
    assert r["quality"] == pytest.approx(1.0)
    assert r["oee"] == pytest.approx(0.8)
    assert r["run_time_s"] == pytest.approx(80.0)
    assert r["planned_time_s"] == pytest.approx(100.0)
    assert r["good_count"] == 8
    assert r["ideal_cycle_s"] == pytest.approx(10.0)
    assert r["state_durations_s"]["running"] == pytest.approx(80.0)
    assert r["state_durations_s"]["down"] == pytest.approx(20.0)


def test_timeline_segments(engine):
    tl = engine.timeline("S1", window="1h")
    assert [s["state"] for s in tl] == ["running", "down", "running"]
    assert [s["duration_s"] for s in tl] == [60.0, 20.0, 20.0]


def test_stations_latest_state(engine):
    st = engine.stations()
    assert st == [{"station_id": "S1", "state": "running", "last_seen": _iso(100)}]


def test_throughput(engine):
    tp = engine.throughput("L1", window="1h")
    assert tp["terminal_station"] == "S1"
    assert tp["good_count"] == 8
    # 8 parts over 100 s -> 288 units/hr
    assert tp["units_per_hr"] == pytest.approx(288.0, rel=1e-3)
    assert sum(b["units"] for b in tp["series"]) == 8


def test_api_endpoints(engine):
    client = TestClient(create_app(engine))
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/stations").json()[0]["station_id"] == "S1"
    oee = client.get("/api/kpi/oee", params={"station": "S1", "window": "1h"}).json()
    assert oee["oee"] == pytest.approx(0.8)
    tp = client.get("/api/kpi/throughput", params={"line": "L1", "window": "1h"}).json()
    assert tp["good_count"] == 8
    tl = client.get("/api/timeline/S1", params={"window": "1h"}).json()
    assert len(tl) == 3
    v = client.get("/api/simulate/validate",
                   params={"line": "L1", "window": "1h", "replications": 2}).json()
    assert {"sim_throughput_units_per_hr", "real_throughput_units_per_hr",
            "error_pct", "params"}.issubset(v)
