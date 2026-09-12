"""Retrofit state inference — current + IR  ->  machine state (novelty #1).

Build plan Phase 8 / §8. On a legacy, un-instrumented machine we only have a
clamp-on CT (current) and an IR part counter. From those alone we infer the
machine state (running / idle / blocked / down) and the true cycle time, with NO
PLC and NO machine modification.

Method (log this precisely for the patent — this file IS the method of record):

  1. Self-calibrating current bands. A rolling window of recent current samples
     yields two thresholds per machine, with no manual setup:
        run_a  = low + RUN_FRAC  * (high - low)     (low=p15, high=p90 of window)
        down_a = max(DOWN_FLOOR_A, DOWN_FRAC * low)
     They adapt continuously, so the method tracks drift and different machines.

  2. Classification per sample (current is EMA-smoothed to reject CT noise):
        current > run_a          -> running        (drawing load)
        current < down_a         -> down           (powered off / fault)
        else + IR part present   -> blocked        (finished, holding a part)
        else + IR no part        -> idle           (starved / waiting)
     A minimum-dwell debounce (N consecutive samples) prevents state chatter.

  3. Cycle time. The IR counter gives part_count directly; a completed cycle time
     is the wall time between consecutive part_count increments (averaged if the
     counter jumped by more than one between samples).

Start with these thresholds; a small learned classifier can replace step 2 if a
machine's bands overlap too much (plan §12 mitigation).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

from services.common.schemas import MachineState

# --- tunables (documented; conservative defaults) ---
WINDOW = 240            # rolling calibration window (samples ~= seconds at 1 Hz)
MIN_CAL_SAMPLES = 30    # need at least this many before trusting learned bands
RUN_FRAC = 0.5          # run threshold sits midway between the low and high bands
DOWN_FRAC = 0.5         # down threshold as a fraction of the low band
DOWN_FLOOR_A = 0.15     # absolute floor for the down threshold (amps)
MIN_SPREAD_A = 0.5      # need this much low..high spread to trust the run threshold
EMA_ALPHA = 0.5         # current smoothing
MIN_DWELL = 2           # consecutive samples required to switch state


@dataclass
class Thresholds:
    down_a: float
    run_a: float
    calibrated: bool


def _two_means(vals, iters: int = 12):
    """1-D 2-means (Lloyd). Returns (low_center, high_center) or None if the two
    clusters aren't separated enough to be meaningful."""
    lo, hi = min(vals), max(vals)
    if hi - lo < MIN_SPREAD_A:
        return None
    c0, c1 = lo, hi
    for _ in range(iters):
        s0 = n0 = s1 = n1 = 0.0
        for v in vals:
            if abs(v - c0) <= abs(v - c1):
                s0 += v; n0 += 1
            else:
                s1 += v; n1 += 1
        nc0 = s0 / n0 if n0 else c0
        nc1 = s1 / n1 if n1 else c1
        if abs(nc0 - c0) < 1e-6 and abs(nc1 - c1) < 1e-6:
            c0, c1 = nc0, nc1
            break
        c0, c1 = nc0, nc1
    if abs(c1 - c0) < MIN_SPREAD_A:
        return None
    return (min(c0, c1), max(c0, c1))


def _percentile(sorted_vals, q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = q * (len(sorted_vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


class CurrentCalibrator:
    """Rolling, self-calibrating current bands (no manual setup)."""

    def __init__(self, window: int = WINDOW, default_run_a: float = 2.0):
        self._buf: deque = deque(maxlen=window)
        self._default_run_a = default_run_a

    def observe(self, current: float) -> None:
        self._buf.append(current)

    def thresholds(self) -> Thresholds:
        if len(self._buf) < MIN_CAL_SAMPLES:
            return Thresholds(down_a=DOWN_FLOOR_A, run_a=self._default_run_a, calibrated=False)
        vals = list(self._buf)
        centers = _two_means(vals)  # robust to class imbalance (unlike percentiles)
        if centers is None:
            return Thresholds(down_a=DOWN_FLOOR_A, run_a=self._default_run_a, calibrated=False)
        low_c, high_c = centers
        # running threshold = midpoint between the not-running and running clusters
        run_a = 0.5 * (low_c + high_c)
        # down threshold sits below the low (idle/blocked) cluster; capped so it
        # never eats the idle band
        down_a = max(DOWN_FLOOR_A, min(0.3, DOWN_FRAC * low_c))
        return Thresholds(down_a=down_a, run_a=run_a, calibrated=True)


class StateInferencer:
    """Per-station: raw (current, IR) -> (state, cycle_time_s)."""

    def __init__(self, station_id: str, calibrator: Optional[CurrentCalibrator] = None):
        self.station_id = station_id
        self.cal = calibrator or CurrentCalibrator()
        self._ema: Optional[float] = None
        self.state: MachineState = MachineState.idle
        self._pending: Optional[MachineState] = None
        self._pending_n = 0
        self._last_count: Optional[int] = None
        self._last_ts: Optional[float] = None
        self._run_accum = 0.0    # running-time accrued toward the current part(s)

    def _classify(self, cur: float, part_present: bool) -> MachineState:
        thr = self.cal.thresholds()
        if cur < thr.down_a:
            return MachineState.down
        if cur > thr.run_a:
            return MachineState.running
        return MachineState.blocked if part_present else MachineState.idle

    def _debounce(self, raw: MachineState) -> MachineState:
        if raw == self.state:
            self._pending, self._pending_n = None, 0
            return self.state
        if raw == self._pending:
            self._pending_n += 1
        else:
            self._pending, self._pending_n = raw, 1
        if self._pending_n >= MIN_DWELL:
            self.state, self._pending, self._pending_n = raw, None, 0
        return self.state

    def update(self, ts_epoch: float, current: float, part_present: bool,
               part_count: int):
        """Feed one raw sample; return (MachineState, cycle_time_s|None).

        cycle_time_s is the PROCESSING time per part — the running-time accrued
        since the last completion, NOT the wall time between completions. This
        excludes blocked/starved gaps, so a blocked station isn't mistaken for a
        slow one (critical for calibrating the twin correctly).
        """
        dt = 0.0 if self._last_ts is None else max(0.0, ts_epoch - self._last_ts)
        self._last_ts = ts_epoch
        self._ema = current if self._ema is None else EMA_ALPHA * current + (1 - EMA_ALPHA) * self._ema
        self.cal.observe(current)
        state = self._debounce(self._classify(self._ema, part_present))
        if state == MachineState.running:
            self._run_accum += dt

        cycle: Optional[float] = None
        if self._last_count is not None and part_count > self._last_count:
            d = part_count - self._last_count
            if self._run_accum > 0:
                cycle = self._run_accum / d
            self._run_accum = 0.0
        self._last_count = part_count
        return state, (round(cycle, 2) if cycle is not None else None)
