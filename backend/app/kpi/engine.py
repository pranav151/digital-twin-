"""KPI engine — turns historian rows into OEE / throughput / timelines.

Backend-agnostic: it only uses the Historian interface, so it runs identically
on the SQLite dev store and on InfluxDB. State durations are reconstructed
*exactly* from the event stream (each event carries the duration of the state it
ended), which is robust to the telemetry sampling rate.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Optional

from services.common.historian import Historian
from services.common.schemas import CODE_STATE

from .oee import compute_oee


def _iso(epoch: float) -> str:
    return (datetime.fromtimestamp(epoch, tz=timezone.utc)
            .isoformat(timespec="seconds").replace("+00:00", "Z"))


def _state_name(code: int) -> str:
    return CODE_STATE[int(code)].value


class KPIEngine:
    def __init__(self, historian: Historian):
        self.h = historian
        self._store = None  # lazy ParamStore for calibration versions

    def _param_store(self):
        if self._store is None:
            from backend.app.twin.calibration_store import ParamStore, default_store_path
            self._store = ParamStore(default_store_path())
        return self._store

    # -- /api/stations ----------------------------------------------------- #
    def stations(self) -> List[dict]:
        out = []
        for sid, (code, ts) in sorted(self.h.latest_states().items()):
            out.append({"station_id": sid, "state": _state_name(code), "last_seen": ts})
        return out

    # -- state timeline (shared by OEE + /api/timeline) -------------------- #
    def _segments(self, tel: List[dict], ev: List[dict]):
        """Reconstruct [start, end, state] segments over the span of `tel`."""
        start = tel[0]["ts_epoch"]
        end = tel[-1]["ts_epoch"]
        prev_ts = start
        prev_state = _state_name(tel[0]["state_code"])
        segs = []
        for e in ev:
            ets = min(max(e["ts_epoch"], start), end)
            if ets > prev_ts:
                segs.append((prev_ts, ets, prev_state))
            prev_state = e["event_type"]
            prev_ts = ets
        if end > prev_ts:
            segs.append((prev_ts, end, prev_state))
        return start, end, segs

    def timeline(self, station: str, window="8h") -> List[dict]:
        tel = self.h.telemetry_rows(window, station)
        if not tel:
            return []
        ev = self.h.event_rows(window, station)
        _, _, segs = self._segments(tel, ev)
        return [{"start": _iso(s), "end": _iso(e), "state": st,
                 "duration_s": round(e - s, 2)} for s, e, st in segs]

    # -- /api/kpi/oee ------------------------------------------------------ #
    def oee(self, station: str, window="8h") -> dict:
        tel = self.h.telemetry_rows(window, station)
        if len(tel) < 2:
            return {"station_id": station, "window": window,
                    "oee": 0.0, "availability": 0.0, "performance": 0.0,
                    "quality": 0.0, "note": "insufficient data"}
        ev = self.h.event_rows(window, station)
        start, end, segs = self._segments(tel, ev)
        span = max(end - start, 1e-9)

        durations = defaultdict(float)
        for s, e, st in segs:
            durations[st] += e - s
        run_time = durations.get("running", 0.0)
        down_time = durations.get("down", 0.0)
        n_down = sum(1 for e in ev if e["event_type"] == "down")
        mtbf_s = round(run_time / n_down, 1) if n_down else None   # mean time between failures
        mttr_s = round(down_time / n_down, 1) if n_down else None  # mean time to repair

        good = int(tel[-1]["part_count"] - tel[0]["part_count"])
        total = good  # no scrap/defect signal yet -> Quality = 1.0 when producing
        cycles = [r["cycle_time_s"] for r in tel
                  if r["cycle_time_s"] is not None and r["cycle_time_s"] > 0]
        ideal_cycle = min(cycles) if cycles else 0.0

        res = compute_oee(run_time_s=run_time, planned_time_s=span,
                          good_count=good, total_count=total, ideal_cycle_s=ideal_cycle)
        out = res.as_dict()
        out.update({
            "station_id": station,
            "window": window,
            "utilization": round(run_time / span, 4),
            "state_durations_s": {k: round(v, 2) for k, v in durations.items()},
            "samples": len(tel),
            "mtbf_s": mtbf_s,
            "mttr_s": mttr_s,
            "down_count": n_down,
            # No scrap/reject sensor on a retrofit cell, so Quality is ASSUMED,
            # not measured. The UI must label it 'assumed' (E2) — never pass an
            # unmeasured 100% off as real (plan OEE note).
            "quality_measured": False,
            "note": "Quality=good/total; no scrap signal yet so total=good "
                    "(Quality=1.0 while producing). ideal_cycle = fastest observed cycle.",
        })
        return out

    # -- /api/analyze/health (predictive maintenance / RUL) ---------------- #
    def health(self, line: str = "L1", window: str = "8h") -> dict:
        """Per-station condition score, failure risk, and an ESTIMATED RUL.

        Built entirely from data we already infer (state timeline → downtime &
        MTBF; telemetry → cycle-time drift from the fastest-observed baseline),
        so it works on a retrofit cell with no dedicated condition sensor — the
        same self-calibrating basis as the twin (patent novelty #1/#2). The RUL is
        a transparent heuristic (a degradation curve over the health score), a
        placeholder for a model calibrated on a labelled dataset (e.g. AI4I 2020).
        """
        NOMINAL_LIFE_H = 720.0  # 30-day nominal service horizon the curve decays over
        rows = []
        for s in self.stations():
            sid = s["station_id"]
            o = self.oee(sid, window)
            a = float(o.get("availability", 0.0) or 0.0)
            p = float(o.get("performance", 0.0) or 0.0)
            n_down = int(o.get("down_count", 0) or 0)
            mtbf_s = o.get("mtbf_s")
            has_cycle = p > 0.0

            reliability = 1.0 / (1.0 + 0.6 * n_down)          # more stops -> lower
            if has_cycle:
                health = 100.0 * (0.40 * a + 0.35 * p + 0.25 * reliability)
                drift_pct = round((1.0 / p - 1.0) * 100.0, 1)  # cycle slowdown vs baseline
                rul_h = round(NOMINAL_LIFE_H * (max(health, 0.0) / 100.0) ** 2, 1)
            else:
                # external/real machine or no part signal: availability-only score
                health = 100.0 * (0.7 * a + 0.3 * reliability)
                drift_pct = None
                rul_h = None
            health = round(max(0.0, min(100.0, health)), 1)

            if health >= 80:   risk = "low"
            elif health >= 60: risk = "medium"
            elif health >= 40: risk = "high"
            else:              risk = "critical"

            # dominant degradation signal
            if n_down > 0 and (1 - a) >= (drift_pct or 0) / 100.0:
                signal = f"{n_down} unplanned stop{'s' if n_down != 1 else ''} in {window}"
            elif drift_pct and drift_pct >= 8:
                signal = f"cycle drift +{drift_pct}% vs baseline"
            elif a < 0.85:
                signal = f"availability {round(a * 100)}%"
            else:
                signal = "nominal"

            rows.append({
                "station_id": sid, "name": s.get("name"),
                "health": health, "risk": risk,
                "rul_hours": rul_h, "rul_days": round(rul_h / 24.0, 1) if rul_h is not None else None,
                "availability": round(a, 3), "performance": round(p, 3),
                "down_count": n_down, "mtbf_s": mtbf_s,
                "cycle_drift_pct": drift_pct, "signal": signal,
                "monitoring_only": not has_cycle,
            })

        order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        rows.sort(key=lambda r: (order[r["risk"]], r["health"]))
        return {"line_id": line, "window": window, "nominal_life_h": NOMINAL_LIFE_H,
                "stations": rows,
                "note": "RUL is an estimated heuristic over the health score, not a "
                        "sensor reading; calibrate on a labelled dataset to productionise."}

    # -- /api/kpi/throughput ---------------------------------------------- #
    def throughput(self, line: str, window="1h", buckets: int = 12) -> dict:
        tel = [r for r in self.h.telemetry_rows(window) if r["line_id"] == line]
        if len(tel) < 2:
            return {"line_id": line, "window": window, "units_per_hr": 0.0,
                    "good_count": 0, "series": [], "note": "insufficient data"}

        # Only stations in the production FLOW count toward line throughput —
        # independent/real monitored cells (e.g. an MTConnect machine placed off
        # the serial line) must not be mistaken for the line terminal.
        flow_ids = None
        try:
            from services.common.assets import get_layout
            ids = {s for edge in (get_layout(line).get("flow") or []) for s in edge}
            flow_ids = ids or None
        except Exception:  # noqa: BLE001
            flow_ids = None

        # terminal station = fewest cumulative completions (most downstream)
        finals = {}
        for r in tel:
            if flow_ids is not None and r["station_id"] not in flow_ids:
                continue
            finals[r["station_id"]] = r["part_count"]  # rows asc -> last wins
        if not finals:  # no flow metadata matched — fall back to every station
            for r in tel:
                finals[r["station_id"]] = r["part_count"]
        terminal = min(finals, key=lambda s: finals[s])
        ts_rows = [r for r in tel if r["station_id"] == terminal]

        start = ts_rows[0]["ts_epoch"]
        end = ts_rows[-1]["ts_epoch"]
        span = max(end - start, 1e-9)
        # Sum POSITIVE increments of the terminal counter, so a counter reset
        # (emulator restart -> part_count drops to 0 mid-window) never yields a
        # negative throughput; production before and after the reset both count.
        good = 0
        for i in range(1, len(ts_rows)):
            d = int(ts_rows[i]["part_count"]) - int(ts_rows[i - 1]["part_count"])
            if d > 0:
                good += d
        units_per_hr = good / (span / 3600.0)

        def count_at(t: float) -> int:
            c = ts_rows[0]["part_count"]
            for r in ts_rows:
                if r["ts_epoch"] <= t:
                    c = r["part_count"]
                else:
                    break
            return int(c)

        n = max(1, min(buckets, int(span // 1) or 1))
        width = span / n
        series = []
        for i in range(n):
            bs, be = start + i * width, start + (i + 1) * width
            u = max(0, count_at(be) - count_at(bs))   # clamp reset boundaries to >= 0
            series.append({"t_start": _iso(bs), "t_end": _iso(be), "units": u,
                           "units_per_hr": round(u / (width / 3600.0), 2)})

        return {"line_id": line, "window": window, "terminal_station": terminal,
                "good_count": good, "units_per_hr": round(units_per_hr, 3),
                "series": series}

    # -- /api/simulate/validate (Phase 4) --------------------------------- #
    def validate(self, line: str = "L1", window: str = "8h", replications: int = 8,
                 buffer_capacity: int = 3, sim_horizon: float | None = None) -> dict:
        """Fit the twin to the historian, run it, and compare sim vs real
        throughput (plan §7 Phase 4 DoD: target error ≤10%)."""
        from backend.app.twin.calibration import fit_line_params
        from backend.app.twin.model import simulate_line

        params = fit_line_params(self, line, window, buffer_capacity)
        sim = simulate_line(params, sim_horizon or params.observed_span_s, replications)
        real = params.real_units_per_hr
        error_pct = (abs(sim.units_per_hr - real) / real * 100.0) if real > 0 else None
        return {
            "line_id": line,
            "window": window,
            "sim_throughput_units_per_hr": round(sim.units_per_hr, 3),
            "real_throughput_units_per_hr": round(real, 3),
            "error_pct": None if error_pct is None else round(error_pct, 2),
            "within_10pct": None if error_pct is None else bool(error_pct <= 10.0),
            "sim": sim.as_dict(),
            "params": params.as_dict(),
        }

    # -- time lost by cause (B2, ThingWorx/FactoryTalk-style) -------------- #
    def losses(self, line: str = "L1", window: str = "8h") -> dict:
        """Total non-running time grouped by (state, reason) across the line —
        the 'downtime / stoppage reasons' panel. Each event enters a state with
        a reason; it lasts until the next event."""
        tel = [r for r in self.h.telemetry_rows(window) if r["line_id"] == line]
        if not tel:
            return {"line_id": line, "window": window, "total_lost_s": 0.0,
                    "by_cause": [], "good_count": 0, "scrap_count": None}
        end_epoch = tel[-1]["ts_epoch"]
        station_ids = sorted({r["station_id"] for r in tel})
        agg: dict = defaultdict(lambda: {"seconds": 0.0, "count": 0})
        for sid in station_ids:
            ev = self.h.event_rows(window, sid)
            for idx, e in enumerate(ev):
                if e["event_type"] == "running":
                    continue
                nxt = ev[idx + 1]["ts_epoch"] if idx + 1 < len(ev) else end_epoch
                dur = max(0.0, nxt - e["ts_epoch"])
                key = (e["event_type"], e.get("reason") or "—")
                agg[key]["seconds"] += dur
                agg[key]["count"] += 1
        by_cause = [{"state": s, "reason": r, "seconds": round(v["seconds"], 1), "count": v["count"]}
                    for (s, r), v in agg.items()]
        by_cause.sort(key=lambda x: -x["seconds"])
        tp = self.throughput(line, window)
        return {"line_id": line, "window": window,
                "total_lost_s": round(sum(c["seconds"] for c in by_cause), 1),
                "by_cause": by_cause,
                "good_count": tp.get("good_count", 0),
                "scrap_count": None}   # no reject sensor on a retrofit cell

    # -- Phase 5: what-if / bottleneck / self-calibration ------------------ #
    def whatif(self, line: str, window: str, changes: list, replications: int = 10,
               buffer_capacity: int = 3) -> dict:
        from backend.app.twin.whatif import run_whatif
        return run_whatif(self, line, window, changes, replications, buffer_capacity)

    def bottleneck(self, line: str = "L1", window: str = "8h", replications: int = 8,
                   buffer_capacity: int = 3) -> dict:
        from backend.app.twin.calibration import fit_line_params
        from backend.app.twin.model import simulate_line
        from backend.app.twin.whatif import detect_bottleneck
        params = fit_line_params(self, line, window, buffer_capacity)
        sim = simulate_line(params, params.observed_span_s, replications)
        out = detect_bottleneck(sim)
        out.update({"line_id": line, "window": window,
                    "sim_units_per_hr": round(sim.units_per_hr, 3)})
        return out

    def optimize(self, line: str = "L1", window: str = "8h", replications: int = 5,
                 buffer_capacity: int = 3) -> dict:
        """Auto what-if optimiser (F2, edge over the giants): fit the twin, then
        search a small change space (speed each station, add an operator, grow the
        buffer) and rank by predicted throughput gain — recommends the best move."""
        from dataclasses import replace
        from backend.app.twin.calibration import fit_line_params
        from backend.app.twin.model import simulate_line
        from backend.app.twin.whatif import apply_changes

        params = fit_line_params(self, line, window, buffer_capacity)
        horizon = min(float(params.observed_span_s or 3600.0), 3600.0)
        seed = 99
        base = simulate_line(params, horizon, replications, seed=seed).units_per_hr

        def run(changes):
            st, buf = apply_changes(params, changes)
            return simulate_line(replace(params, stations=st, buffer_capacity=buf),
                                 horizon, replications, seed=seed).units_per_hr

        candidates = []
        for sp in params.stations:
            for ch, label in (
                ({"type": "cycle_reduction", "station": sp.station_id, "percent": 20},
                 f"Speed up {sp.station_id} 20%"),
                ({"type": "add_operator", "station": sp.station_id, "operators": 1},
                 f"Add an operator at {sp.station_id}"),
            ):
                p = run([ch])
                candidates.append({"label": label, "change": ch, "predicted": round(p, 2),
                                   "delta_pct": round((p - base) / base * 100, 2) if base > 0 else 0.0})
        for cap in (buffer_capacity + 2, buffer_capacity + 5):
            p = run([{"type": "buffer_size", "value": cap}])
            candidates.append({"label": f"Grow buffers to {cap}",
                               "change": {"type": "buffer_size", "value": cap},
                               "predicted": round(p, 2),
                               "delta_pct": round((p - base) / base * 100, 2) if base > 0 else 0.0})

        candidates.sort(key=lambda c: -c["delta_pct"])
        return {"line_id": line, "window": window, "baseline_units_per_hr": round(base, 2),
                "recommended": candidates[0] if candidates else None, "candidates": candidates}

    def calibrate(self, line: str = "L1", window: str = "1h",
                  buffer_capacity: int = 3) -> dict:
        from backend.app.twin.calibration_store import calibrate_and_store
        return calibrate_and_store(self, self._param_store(), line, window, buffer_capacity)

    def calibrations(self, line: str | None = None, limit: int = 50) -> list:
        return self._param_store().list(line, limit)
