"""OEE math — implemented exactly per build plan §6.4.

    OEE          = Availability × Performance × Quality
    Availability = run_time / planned_time
    Performance  = (ideal_cycle_s × good_count) / run_time
    Quality      = good_count / total_count

This is a pure function of its inputs (no I/O), so it is directly unit-tested
with fixed numbers (see backend/tests/test_oee.py). The KPI engine extracts the
inputs from the historian and calls this.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


@dataclass(frozen=True)
class OEEResult:
    oee: float
    availability: float
    performance: float
    quality: float
    # inputs echoed back for transparency / debugging / the API response
    run_time_s: float
    planned_time_s: float
    good_count: int
    total_count: int
    ideal_cycle_s: float

    def as_dict(self) -> dict:
        return asdict(self)


def compute_oee(
    *,
    run_time_s: float,
    planned_time_s: float,
    good_count: int,
    total_count: int,
    ideal_cycle_s: float,
) -> OEEResult:
    """Compute OEE and its three factors.

    Factors are clamped to [0, 1]: Performance can nudge slightly above 1 when
    ``ideal_cycle_s`` is estimated as the fastest observed cycle and measurement
    noise makes the mean faster than that estimate — clamping keeps the reported
    number physically meaningful.
    """
    availability = run_time_s / planned_time_s if planned_time_s > 0 else 0.0
    performance = (
        (ideal_cycle_s * good_count) / run_time_s
        if run_time_s > 0 and ideal_cycle_s > 0
        else 0.0
    )
    quality = good_count / total_count if total_count > 0 else 0.0

    availability = _clamp01(availability)
    performance = _clamp01(performance)
    quality = _clamp01(quality)
    oee = availability * performance * quality

    return OEEResult(
        oee=oee,
        availability=availability,
        performance=performance,
        quality=quality,
        run_time_s=run_time_s,
        planned_time_s=planned_time_s,
        good_count=good_count,
        total_count=total_count,
        ideal_cycle_s=ideal_cycle_s,
    )
