"""What-if engine + bottleneck detection (build plan Phase 5, novelty #3).

Takes the calibrated twin, applies a list of hypothetical changes, re-runs the
simulation, and returns predicted vs baseline KPIs. Deterministic seed option so
demos are reproducible; baseline and predicted share seeds (common random
numbers) so the delta reflects the change, not RNG noise.

Supported changes (list of dicts):
  {"type":"cycle_reduction","station":"S3","percent":20}   # 20% faster S3
  {"type":"add_operator","station":"S3","operators":1}     # +1 operator -> cycle/(1+n)
  {"type":"set_cycle","station":"S3","value":40}           # set absolute mean cycle
  {"type":"buffer_size","value":5}                         # line-wide buffer capacity
"""

from __future__ import annotations

import copy
from dataclasses import replace
from typing import Dict, List

from .calibration import LineParams, StationParams
from .model import SimResult, simulate_line


def _scale_station(sp: StationParams, factor: float) -> None:
    sp.loc *= factor
    sp.scale *= factor
    sp.mean_cycle_s *= factor
    sp.min_cycle_s *= factor


def apply_changes(params: LineParams, changes: List[dict]):
    """Return (new_stations, new_buffer_capacity) with `changes` applied."""
    stations = copy.deepcopy(params.stations)
    buffer = params.buffer_capacity
    by_id: Dict[str, StationParams] = {s.station_id: s for s in stations}

    for ch in changes:
        t = str(ch.get("type", "")).lower()
        if t == "cycle_reduction":
            factor = max(0.0, 1.0 - float(ch["percent"]) / 100.0)
            targets = [by_id[ch["station"]]] if ch.get("station") else stations
            for s in targets:
                _scale_station(s, factor)
        elif t == "add_operator":
            n = int(ch.get("operators", 1))
            _scale_station(by_id[ch["station"]], 1.0 / (1 + max(0, n)))
        elif t == "set_cycle":
            s = by_id[ch["station"]]
            new = float(ch["value"])
            factor = new / s.loc if s.loc > 0 else 1.0
            s.loc = new
            s.scale *= factor
            s.mean_cycle_s = new
            s.min_cycle_s *= factor
        elif t == "buffer_size":
            buffer = int(ch["value"])
        else:
            raise ValueError(f"unknown what-if change type: {ch.get('type')!r}")
    return stations, buffer


def rank_utilization(sim: SimResult) -> List[dict]:
    return [{"station": k, "utilization": round(v, 4)}
            for k, v in sorted(sim.per_station_utilization.items(),
                               key=lambda kv: kv[1], reverse=True)]


def detect_bottleneck(sim: SimResult) -> dict:
    ranked = rank_utilization(sim)
    top = ranked[0] if ranked else {"station": None, "utilization": 0.0}
    return {"bottleneck": top["station"], "utilization": top["utilization"],
            "ranking": ranked}


def run_whatif(engine, line: str, window: str, changes: List[dict],
               replications: int = 10, buffer_capacity: int = 3,
               seed: int = 4242) -> dict:
    from .calibration import fit_line_params

    params = fit_line_params(engine, line, window, buffer_capacity)
    horizon = params.observed_span_s or 3600.0

    baseline = simulate_line(params, horizon, replications, seed=seed)
    new_stations, new_buffer = apply_changes(params, changes)
    mod = replace(params, stations=new_stations, buffer_capacity=new_buffer)
    predicted = simulate_line(mod, horizon, replications, seed=seed)

    b, p = baseline.units_per_hr, predicted.units_per_hr
    delta = p - b
    return {
        "line_id": line,
        "window": window,
        "changes": changes,
        "baseline": {"units_per_hr": round(b, 3),
                     "bottleneck": detect_bottleneck(baseline)},
        "predicted": {"units_per_hr": round(p, 3),
                      "bottleneck": detect_bottleneck(predicted)},
        "delta_units_per_hr": round(delta, 3),
        "delta_pct": round((delta / b * 100.0) if b > 0 else 0.0, 2),
        "baseline_sim": baseline.as_dict(),
        "predicted_sim": predicted.as_dict(),
    }
