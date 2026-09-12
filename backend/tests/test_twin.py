"""Twin (SimPy) + calibration tests — Phase 4.

These use synthetic/seeded inputs so they're deterministic (fixed RNG seeds)
and don't need a running broker or InfluxDB.
"""

from datetime import datetime, timedelta, timezone

import pytest

from backend.app.kpi.engine import KPIEngine
from backend.app.twin.calibration import LineParams, StationParams, fit_line_params
from backend.app.twin.model import simulate_line
from services.common.historian import SqliteHistorian
from services.common.schemas import MachineState, Telemetry

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _iso(s):
    return (BASE + timedelta(seconds=s)).isoformat(timespec="seconds").replace("+00:00", "Z")


def _sp(sid, cyc, scale=0.4):
    return StationParams(station_id=sid, dist="norm", loc=cyc, scale=scale,
                         n_samples=100, mean_cycle_s=cyc, std_cycle_s=scale,
                         min_cycle_s=cyc - 1)


def _line(stations):
    return LineParams(line_id="L1", window="1h", stations=stations, buffer_capacity=3,
                      real_units_per_hr=0.0, observed_span_s=7200.0,
                      terminal_station=stations[-1].station_id)


def test_balanced_line_throughput():
    # 3 balanced 10 s stations -> ~360 parts/hr (1 part / 10 s)
    res = simulate_line(_line([_sp("S1", 10), _sp("S2", 10), _sp("S3", 10)]),
                        sim_horizon_s=7200, replications=5, seed=1)
    assert 345 <= res.units_per_hr <= 365


def test_bottleneck_limits_and_is_saturated():
    # slow S3 (20 s) sets the pace -> ~180 parts/hr; S3 ~fully utilized
    res = simulate_line(_line([_sp("S1", 10), _sp("S2", 10), _sp("S3", 20), _sp("S4", 10)]),
                        sim_horizon_s=7200, replications=5, seed=2)
    assert 165 <= res.units_per_hr <= 185
    assert res.per_station_utilization["S3"] > 0.9
    assert res.per_station_utilization["S1"] < 0.75


def test_calibration_recovers_cycle(tmp_path):
    h = SqliteHistorian(str(tmp_path / "c.sqlite"))
    for k in range(12):
        cyc = 12.0 + (0.2 if k % 2 else -0.2)
        h.write_telemetry(Telemetry(ts=_iso(k * 12), line_id="L1", station_id="S1",
                                     current_a=4.5, part_present=True, part_count=k,
                                     cycle_time_s=cyc, state=MachineState.running))
    lp = fit_line_params(KPIEngine(h), line="L1", window="1h")
    assert lp.stations[0].loc == pytest.approx(12.0, abs=0.5)
    assert lp.stations[0].n_samples == 12
