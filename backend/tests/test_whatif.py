"""What-if engine, bottleneck detection, and calibration store tests — Phase 5."""

from dataclasses import replace

import pytest

from backend.app.twin.calibration import LineParams, StationParams
from backend.app.twin.calibration_store import ParamStore
from backend.app.twin.model import simulate_line
from backend.app.twin.whatif import apply_changes, detect_bottleneck


def _sp(sid, cyc):
    return StationParams(station_id=sid, dist="norm", loc=cyc, scale=0.3,
                         n_samples=100, mean_cycle_s=cyc, std_cycle_s=0.3, min_cycle_s=cyc - 1)


def _line(stations):
    return LineParams(line_id="L1", window="1h", stations=stations, buffer_capacity=3,
                      real_units_per_hr=0.0, observed_span_s=7200.0,
                      terminal_station=stations[-1].station_id)


def test_apply_cycle_reduction():
    st, _ = apply_changes(_line([_sp("S1", 10), _sp("S2", 20)]),
                          [{"type": "cycle_reduction", "station": "S2", "percent": 50}])
    assert st[1].loc == pytest.approx(10.0)


def test_add_operator_halves_cycle():
    st, _ = apply_changes(_line([_sp("S1", 20)]),
                          [{"type": "add_operator", "station": "S1", "operators": 1}])
    assert st[0].loc == pytest.approx(10.0)


def test_set_cycle_and_buffer():
    st, buf = apply_changes(_line([_sp("S1", 10), _sp("S2", 10)]),
                            [{"type": "set_cycle", "station": "S2", "value": 15},
                             {"type": "buffer_size", "value": 7}])
    assert st[1].loc == pytest.approx(15.0)
    assert buf == 7


def test_unknown_change_raises():
    with pytest.raises(ValueError):
        apply_changes(_line([_sp("S1", 10)]), [{"type": "teleport"}])


def test_detect_bottleneck_picks_slowest():
    sim = simulate_line(_line([_sp("S1", 10), _sp("S2", 30), _sp("S3", 10)]),
                        sim_horizon_s=7200, replications=5, seed=1)
    assert detect_bottleneck(sim)["bottleneck"] == "S2"


def test_whatif_speeding_bottleneck_raises_throughput():
    lp = _line([_sp("S1", 10), _sp("S2", 10), _sp("S3", 20), _sp("S4", 10)])
    base = simulate_line(lp, 7200, 5, seed=3)
    assert detect_bottleneck(base)["bottleneck"] == "S3"
    st, buf = apply_changes(lp, [{"type": "cycle_reduction", "station": "S3", "percent": 50}])
    pred = simulate_line(replace(lp, stations=st, buffer_capacity=buf), 7200, 5, seed=3)
    assert pred.units_per_hr > base.units_per_hr * 1.2   # meaningfully faster


def test_param_store_versions(tmp_path):
    store = ParamStore(str(tmp_path / "c.sqlite"))
    lp = _line([_sp("S1", 10)])
    v1 = store.add(lp)
    v2 = store.add(replace(lp, real_units_per_hr=99.0))
    assert v2 == v1 + 1
    rows = store.list("L1")
    assert len(rows) == 2
    assert rows[0]["version"] == v2          # newest first
    assert store.latest("L1")["version"] == v2
    store.close()
