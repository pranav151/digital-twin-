"""Calibration — fit the twin's parameters FROM the historian (build plan Phase 4/5).

For each station we fit a cycle-time distribution (scipy) to the observed
`cycle_time_s` values and estimate reliability (MTBF/MTTR) from the state
timeline — so the simulation is *fitted to reality*, never hardcoded. This is
the input both to validation (Phase 4) and to the self-calibration loop and
what-if engine (Phase 5, the patent core).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import List

import numpy as np
from scipy import stats


@dataclass
class StationParams:
    station_id: str
    dist: str                 # distribution family fitted (currently 'norm')
    loc: float                # fitted mean
    scale: float              # fitted std
    n_samples: int
    mean_cycle_s: float
    std_cycle_s: float
    min_cycle_s: float
    # reliability (0 => no breakdowns observed)
    mtbf_s: float = 0.0
    mttr_s: float = 0.0
    downtime_frac: float = 0.0

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class LineParams:
    line_id: str
    window: str
    stations: List[StationParams]      # in serial order
    buffer_capacity: int
    real_units_per_hr: float
    observed_span_s: float
    terminal_station: str
    fitted_at: str = ""

    def as_dict(self) -> dict:
        d = asdict(self)
        d["stations"] = [s.as_dict() for s in self.stations]
        return d


def _fit_cycle_dist(cycles: List[float]):
    """Return (loc, scale, mean, std, min) for the cycle-time samples.

    Guards against mixed/dirty data (D4, ref: Tecnomatix Excel-import lesson):
    NaN/±inf and non-positive values are dropped before fitting, so a single
    bad historian row can't corrupt the distribution fit.
    """
    raw = np.asarray([c for c in cycles if c is not None], dtype=float)
    arr = raw[np.isfinite(raw) & (raw > 0)] if raw.size else raw
    if arr.size == 0:
        return 0.0, 0.0, 0.0, 0.0, 0.0
    mean = float(arr.mean())
    std = float(arr.std(ddof=1)) if arr.size > 1 else 0.0
    mn = float(arr.min())
    if arr.size >= 3 and std > 0:
        loc, scale = stats.norm.fit(arr)   # MLE fit
    else:
        loc, scale = mean, max(std, 0.02 * mean)
    return float(loc), float(scale), mean, std, mn


def fit_line_params(engine, line: str = "L1", window: str = "8h",
                    buffer_capacity: int = 3) -> LineParams:
    """Fit LineParams from the historian, reusing the KPI engine for state
    durations + actual throughput. `engine` is a KPIEngine.
    """
    from datetime import datetime, timezone

    rows = [r for r in engine.h.telemetry_rows(window) if r["line_id"] == line]
    station_ids = sorted({r["station_id"] for r in rows})

    stations: List[StationParams] = []
    for sid in station_ids:
        srows = [r for r in rows if r["station_id"] == sid]
        cycles = [r["cycle_time_s"] for r in srows]
        loc, scale, mean, std, mn = _fit_cycle_dist(cycles)

        # reliability from the reconstructed state timeline + down events
        oee = engine.oee(sid, window)
        durs = oee.get("state_durations_s", {})
        run_time = float(durs.get("running", 0.0))
        down_time = float(durs.get("down", 0.0))
        span = max(float(oee.get("planned_time_s", 0.0)), 1e-9)
        n_down = sum(1 for e in engine.h.event_rows(window, sid)
                     if e["event_type"] == "down")
        mtbf = run_time / n_down if n_down else 0.0
        mttr = down_time / n_down if n_down else 0.0

        stations.append(StationParams(
            station_id=sid, dist="norm", loc=loc, scale=scale,
            n_samples=len([c for c in cycles if c]), mean_cycle_s=round(mean, 3),
            std_cycle_s=round(std, 3), min_cycle_s=round(mn, 3),
            mtbf_s=round(mtbf, 2), mttr_s=round(mttr, 2),
            downtime_frac=round(down_time / span, 4),
        ))

    tp = engine.throughput(line, window)
    span = 0.0
    if rows:
        span = rows[-1]["ts_epoch"] - rows[0]["ts_epoch"]

    return LineParams(
        line_id=line, window=window, stations=stations,
        buffer_capacity=buffer_capacity,
        real_units_per_hr=float(tp.get("units_per_hr", 0.0)),
        observed_span_s=round(span, 2),
        terminal_station=tp.get("terminal_station", station_ids[-1] if station_ids else ""),
        fitted_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )
