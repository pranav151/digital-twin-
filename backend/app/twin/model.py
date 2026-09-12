"""SimPy discrete-event twin of the cell (build plan Phase 4).

Serial line: infinite source -> S1 -[buffer]- S2 -[buffer]- ... -> sink.
Stations are SimPy processes; buffers are SimPy Stores of finite capacity, so
blocking (downstream Store full) and starving (upstream Store empty) emerge from
the model rather than being scripted — the same dynamics as the emulator, but
here driven by the distributions *fitted to the historian* (see calibration.py).

Cycle times are sampled from each station's fitted normal; breakdowns (when the
historian shows any) are injected with the fitted MTBF/MTTR.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np
import simpy

from .calibration import LineParams, StationParams


@dataclass
class SimResult:
    units_per_hr: float          # mean terminal throughput across replications
    units_per_hr_std: float
    replications: int
    sim_horizon_s: float
    per_station_counts: Dict[str, float]   # mean completions per station
    per_station_utilization: Dict[str, float]
    per_replication: List[float]

    def as_dict(self) -> dict:
        return {
            "units_per_hr": round(self.units_per_hr, 3),
            "units_per_hr_std": round(self.units_per_hr_std, 3),
            "replications": self.replications,
            "sim_horizon_s": self.sim_horizon_s,
            "per_station_counts": {k: round(v, 1) for k, v in self.per_station_counts.items()},
            "per_station_utilization": {k: round(v, 4) for k, v in self.per_station_utilization.items()},
            "per_replication_units_per_hr": [round(x, 2) for x in self.per_replication],
        }


def _make_sampler(sp: StationParams, rng: np.random.Generator):
    loc = sp.loc if sp.loc > 0 else max(sp.mean_cycle_s, 1.0)
    scale = sp.scale if sp.scale > 0 else max(0.02 * loc, 0.01)
    floor = max(0.25 * loc, 0.1)

    def sample() -> float:
        return max(float(rng.normal(loc, scale)), floor)

    return sample


def _run_once(stations: List[StationParams], buffer_capacity: int,
              sim_horizon_s: float, rng: np.random.Generator):
    env = simpy.Environment()
    n = len(stations)
    buffers = [simpy.Store(env, capacity=buffer_capacity) for _ in range(max(0, n - 1))]
    counts = [0] * n
    busy_time = [0.0] * n

    def station_proc(i: int, sp: StationParams):
        sampler = _make_sampler(sp, rng)
        while True:
            if i > 0:
                part = yield buffers[i - 1].get()      # starve if empty
            else:
                part = 1                               # infinite source
            cyc = sampler()
            t0 = env.now
            yield env.timeout(cyc)                     # process
            # inject a breakdown if the historian showed any for this station
            if sp.mtbf_s > 0 and sp.mttr_s > 0:
                p_fail = 1.0 - math.exp(-cyc / sp.mtbf_s)
                if rng.random() < p_fail:
                    yield env.timeout(max(1.0, float(rng.normal(sp.mttr_s, 0.3 * sp.mttr_s))))
            busy_time[i] += env.now - t0
            counts[i] += 1
            if i < n - 1:
                yield buffers[i].put(part)             # block if downstream full
            # last station -> sink (exits)

    for i, sp in enumerate(stations):
        env.process(station_proc(i, sp))
    env.run(until=sim_horizon_s)

    terminal_units = counts[-1] if n else 0
    util = {sp.station_id: (busy_time[i] / sim_horizon_s if sim_horizon_s > 0 else 0.0)
            for i, sp in enumerate(stations)}
    per_counts = {sp.station_id: counts[i] for i, sp in enumerate(stations)}
    return terminal_units, per_counts, util


def simulate_line(params: LineParams, sim_horizon_s: Optional[float] = None,
                  replications: int = 8, seed: int = 12345,
                  overrides: Optional[List[StationParams]] = None) -> SimResult:
    """Run the twin for `replications` seeds and average terminal throughput.

    `overrides` (Phase 5 what-if) replaces the station list; otherwise the
    calibrated params are used as-is.
    """
    stations = overrides if overrides is not None else params.stations
    horizon = float(sim_horizon_s or params.observed_span_s or 3600.0)

    thr, agg_counts, agg_util = [], None, None
    for rep in range(replications):
        rng = np.random.default_rng(seed + rep)
        terminal, counts, util = _run_once(stations, params.buffer_capacity, horizon, rng)
        thr.append(terminal / (horizon / 3600.0))
        if agg_counts is None:
            agg_counts = {k: 0.0 for k in counts}
            agg_util = {k: 0.0 for k in util}
        for k in counts:
            agg_counts[k] += counts[k] / replications
            agg_util[k] += util[k] / replications

    arr = np.asarray(thr)
    return SimResult(
        units_per_hr=float(arr.mean()),
        units_per_hr_std=float(arr.std()),
        replications=replications,
        sim_horizon_s=horizon,
        per_station_counts=agg_counts or {},
        per_station_utilization=agg_util or {},
        per_replication=thr,
    )
