#!/usr/bin/env python3
"""Edge emulator — a hardware-free factory cell that streams realistic MQTT.

Build plan Phase 1. This lets the ENTIRE software stack (ingestion, KPI engine,
digital twin, dashboard) be built and validated before any real machine exists.
The real ESP32 firmware (Phase 8) publishes the *same* schema to the *same*
topics, so nothing downstream changes when hardware is swapped in.

Model
-----
A serial line of N stations with finite buffers between them. Each tick the
simulator advances processing, resolves material movement (blocking / starving),
rolls for breakdowns, and publishes per-station telemetry (~1 Hz) plus an event
on every state change. Cycle times are sampled from a normal distribution per
part; breakdowns follow an exponential MTBF with a sampled MTTR repair time.

Each station also emits a realistic clamp-on CURRENT signature per state
(running draws load current, idle/blocked draw standby, down ≈ 0) with gaussian
noise — this is the raw signal the Phase-8 state-inference novelty will consume.

Usage
-----
    python edge/emulator/emulator.py --scenario normal            # -> MQTT broker
    python edge/emulator/emulator.py --scenario bottleneck --print
    python edge/emulator/emulator.py --scenario breakdown --dry-run --speed 20
    python edge/emulator/emulator.py --list-scenarios
"""

from __future__ import annotations

import argparse
import math
import os
import random
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import yaml

# --- make `services.common` importable regardless of where we're launched from
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.common import (  # noqa: E402
    Event,
    EventType,
    MachineState,
    PartExit,
    RawTelemetry,
    SourceType,
    Telemetry,
    event_topic,
    part_topic,
    raw_topic,
    telemetry_topic,
    utcnow_iso,
)

SCENARIO_DIR = Path(__file__).resolve().parent / "scenarios"


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
@dataclass
class StationConfig:
    id: str
    cycle_mean_s: float
    cycle_std_s: float
    # Reliability. mtbf_s <= 0 disables breakdowns for this station.
    mtbf_s: float = 0.0
    mttr_mean_s: float = 60.0
    mttr_std_s: float = 20.0
    # Current signature (amps) per state — the Route-B raw signal.
    current_running_a: float = 4.5
    current_idle_a: float = 0.4
    current_blocked_a: float = 0.8
    current_down_a: float = 0.05
    current_noise_a: float = 0.15
    # planned maintenance (0 disables): enter maintenance every maint_every_s of
    # running, for maint_dur_s. Distinct from unplanned breakdowns (mtbf/mttr).
    maint_every_s: float = 0.0
    maint_dur_s: float = 120.0


@dataclass
class Scenario:
    name: str
    description: str
    line_id: str
    tick_hz: float
    buffer_capacity: int
    source_infinite: bool
    sink_infinite: bool
    seed: int
    stations: List[StationConfig] = field(default_factory=list)


_DEFAULT_STATION_KEYS = {
    "cycle_std_s",
    "mtbf_s",
    "mttr_mean_s",
    "mttr_std_s",
    "current_running_a",
    "current_idle_a",
    "current_blocked_a",
    "current_down_a",
    "current_noise_a",
    "maint_every_s",
    "maint_dur_s",
}


def load_scenario(name_or_path: str) -> Scenario:
    """Load a scenario by bare name (looked up in scenarios/) or by file path."""
    path = Path(name_or_path)
    if not path.exists():
        candidate = SCENARIO_DIR / f"{name_or_path}.yaml"
        if candidate.exists():
            path = candidate
        else:
            raise FileNotFoundError(
                f"Scenario '{name_or_path}' not found. Looked for {path} and {candidate}. "
                f"Available: {', '.join(list_scenarios()) or '(none)'}"
            )

    with open(path, "r") as f:
        raw = yaml.safe_load(f) or {}

    defaults = raw.get("defaults", {}) or {}
    cycle_std_frac = float(defaults.get("cycle_std_frac", 0.08))

    stations: List[StationConfig] = []
    for s in raw.get("stations", []):
        mean = float(s["cycle_mean_s"])
        merged = {}
        for key in _DEFAULT_STATION_KEYS:
            if key in s:
                merged[key] = s[key]
            elif key in defaults:
                merged[key] = defaults[key]
        # Derive a std from the fraction if none was given explicitly.
        if "cycle_std_s" not in merged:
            merged["cycle_std_s"] = round(mean * cycle_std_frac, 3)
        stations.append(StationConfig(id=str(s["id"]), cycle_mean_s=mean, **merged))

    if not stations:
        raise ValueError(f"Scenario {path} defines no stations.")

    return Scenario(
        name=str(raw.get("name", path.stem)),
        description=str(raw.get("description", "")),
        line_id=str(raw.get("line_id", "L1")),
        tick_hz=float(raw.get("tick_hz", 1.0)),
        buffer_capacity=int(raw.get("buffer_capacity", 3)),
        source_infinite=bool(raw.get("source_infinite", True)),
        sink_infinite=bool(raw.get("sink_infinite", True)),
        seed=int(raw.get("seed", 42)),
        stations=stations,
    )


def list_scenarios() -> List[str]:
    if not SCENARIO_DIR.exists():
        return []
    return sorted(p.stem for p in SCENARIO_DIR.glob("*.yaml"))


# --------------------------------------------------------------------------- #
# Publishers
# --------------------------------------------------------------------------- #
class Publisher:
    def publish(self, topic: str, payload: str) -> None:  # pragma: no cover
        raise NotImplementedError

    def close(self) -> None:
        pass


class PrintPublisher(Publisher):
    """Dry-run sink: prints every payload. Needs no broker."""

    def __init__(self, show: bool = True):
        self.show = show

    def publish(self, topic: str, payload: str) -> None:
        if self.show:
            print(f"{topic}  {payload}")


class MqttPublisher(Publisher):
    def __init__(self, host: str, port: int, username: str = "", password: str = ""):
        import paho.mqtt.client as mqtt

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=f"emulator-{os.getpid()}"
        )
        if username:
            self._client.username_pw_set(username, password)
        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        try:
            self._client.connect(host, port, keepalive=60)
        except Exception as exc:  # noqa: BLE001
            raise ConnectionError(
                f"Could not reach MQTT broker at {host}:{port} ({exc}). "
                f"Start it with `docker compose up -d`, or run with --dry-run."
            ) from exc
        self._client.loop_start()
        self.host, self.port = host, port

    def publish(self, topic: str, payload: str) -> None:
        self._client.publish(topic, payload, qos=0, retain=False)

    def close(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()


# --------------------------------------------------------------------------- #
# Simulation
# --------------------------------------------------------------------------- #
class Station:
    """Runtime state for a single station in the serial line."""

    def __init__(self, cfg: StationConfig, rng: random.Random):
        self.cfg = cfg
        self.rng = rng
        self.state: MachineState = MachineState.idle
        self.part_count = 0            # cumulative good parts completed
        self.last_cycle_time_s: Optional[float] = None
        self.part_present = False

        self._remaining_s = 0.0        # remaining processing time of current part
        self._current_cycle_len = 0.0  # planned length of current part's cycle
        self._holding_finished = False # completed a part, waiting to hand it off
        self._repair_remaining_s = 0.0 # remaining downtime while broken
        self._maint_remaining_s = 0.0  # remaining time in planned maintenance
        self._since_maint_s = 0.0      # running time accrued since last maintenance
        self._state_age_s = 0.0        # how long we've been in the current state

    # -- helpers ----------------------------------------------------------- #
    def _sample_cycle(self) -> float:
        v = self.rng.gauss(self.cfg.cycle_mean_s, self.cfg.cycle_std_s)
        return max(v, 0.25 * self.cfg.cycle_mean_s, 1.0)

    def _sample_repair(self) -> float:
        v = self.rng.gauss(self.cfg.mttr_mean_s, self.cfg.mttr_std_s)
        return max(v, 1.0)

    def _set_state(self, new_state: MachineState):
        if new_state != self.state:
            self.state = new_state
            self._state_age_s = 0.0

    def current_reading(self) -> float:
        c = self.cfg
        if self.state == MachineState.running:
            base = c.current_running_a
            # gentle intra-cycle modulation so it isn't a dead-flat line
            if self._current_cycle_len > 0:
                phase = 1.0 - (self._remaining_s / self._current_cycle_len)
                base += 0.12 * c.current_running_a * math.sin(math.pi * phase)
        elif self.state == MachineState.blocked:
            base = c.current_blocked_a
        elif self.state == MachineState.down:
            base = c.current_down_a
        elif self.state == MachineState.maintenance:
            base = c.current_down_a          # powered down for service
        else:
            base = c.current_idle_a          # idle / starved: standby draw
        return max(0.0, base + self.rng.gauss(0.0, c.current_noise_a))


class LineSimulator:
    """Serial line: source -> S0 -[buf0]- S1 -[buf1]- ... -> sink."""

    def __init__(self, scenario: Scenario):
        self.scenario = scenario
        self.rng = random.Random(scenario.seed)
        # give each station its own rng stream, derived from the master seed
        self.stations = [
            Station(cfg, random.Random(scenario.seed + i + 1))
            for i, cfg in enumerate(scenario.stations)
        ]
        n = len(self.stations)
        self.buffers = [0] * max(0, n - 1)   # buffers[i] sits between station i and i+1
        self.cap = scenario.buffer_capacity
        self.sim_time_s = 0.0
        # Stamp messages on a SIMULATED clock (base = now, + sim_time). This keeps
        # timestamps, cycle times, state durations and part counts all on one
        # consistent timeline regardless of --speed, so downstream KPIs are correct.
        self.base_time = datetime.now(timezone.utc)
        # events accumulated during the last step(), drained by the runner
        self._pending_events: List[dict] = []
        # per-part traceability: FIFO of (part_id, entry_sim_ts) for parts on the
        # line; a serial line is FIFO (no overtaking), so entry pairs with exit.
        self._in_line: deque = deque()
        self._next_part_id = 1
        self._pending_parts: List[dict] = []

    # -- movement helpers -------------------------------------------------- #
    def _downstream_has_space(self, i: int) -> bool:
        if i == len(self.stations) - 1:
            return True if self.scenario.sink_infinite else False
        return self.buffers[i] < self.cap

    def _push_downstream(self, i: int) -> None:
        if i < len(self.stations) - 1:
            self.buffers[i] += 1
        # last station -> sink (infinite): nothing to track

    def _upstream_has_part(self, i: int) -> bool:
        if i == 0:
            return True if self.scenario.source_infinite else False
        return self.buffers[i - 1] > 0

    def _take_upstream(self, i: int) -> None:
        if i > 0:
            self.buffers[i - 1] -= 1
        # first station <- source (infinite): nothing to track

    def _emit_event(self, st: Station, new_state: MachineState, reason: Optional[str]):
        """Record a transition, tagging it with the duration of the ending state."""
        self._pending_events.append(
            {
                "station_id": st.cfg.id,
                "event_type": EventType(new_state.value),
                "reason": reason,
                "duration_s": round(st._state_age_s, 2),
            }
        )

    def _transition(self, st: Station, new_state: MachineState, reason=None):
        if new_state != st.state:
            self._emit_event(st, new_state, reason)
            st._set_state(new_state)

    # -- advancing time ---------------------------------------------------- #
    def advance(self, dt: float, max_step: float = 1.0) -> None:
        """Advance sim time by `dt` using fine internal physics steps (default
        1 s), so the produced dynamics (throughput, cycle timing) are the same
        regardless of the publish cadence / --speed. Events from all sub-steps
        are accumulated so the tick can publish them together.
        """
        acc: List[dict] = []
        pacc: List[dict] = []
        remaining = dt
        while remaining > 1e-9:
            sd = min(max_step, remaining)
            self.step(sd)
            acc.extend(self._pending_events)
            pacc.extend(self._pending_parts)
            remaining -= sd
        self._pending_events = acc
        self._pending_parts = pacc

    # -- the tick ---------------------------------------------------------- #
    def step(self, dt: float) -> None:
        self._pending_events = []
        self._pending_parts = []
        self.sim_time_s += dt
        for st in self.stations:
            st._state_age_s += dt

        # Phase A: advance timers (processing + repair + maintenance), roll breakdowns.
        for st in self.stations:
            if st.state == MachineState.down:
                st._repair_remaining_s -= dt
                if st._repair_remaining_s <= 0:
                    # repaired; the in-progress part resumes (state resolved in Phase B)
                    st._holding_finished = False
                    self._transition(st, MachineState.running, reason="repaired")
                    st.part_present = True
                continue

            if st.state == MachineState.maintenance:
                st._maint_remaining_s -= dt
                if st._maint_remaining_s <= 0:
                    st._holding_finished = False
                    self._transition(st, MachineState.running, reason="maintenance_done")
                    st.part_present = True
                continue

            if st.state == MachineState.running:
                # breakdown risk accrues only under load (unplanned)
                if st.cfg.mtbf_s > 0:
                    p_fail = 1.0 - math.exp(-dt / st.cfg.mtbf_s)
                    if st.rng.random() < p_fail:
                        st._repair_remaining_s = st._sample_repair()
                        st.part_present = True
                        self._transition(st, MachineState.down, reason="breakdown")
                        continue

                # planned maintenance every maint_every_s of running time
                if st.cfg.maint_every_s > 0:
                    st._since_maint_s += dt
                    if st._since_maint_s >= st.cfg.maint_every_s:
                        st._since_maint_s = 0.0
                        st._maint_remaining_s = st.cfg.maint_dur_s
                        st.part_present = True
                        self._transition(st, MachineState.maintenance, reason="planned_service")
                        continue

                st._remaining_s -= dt
                if st._remaining_s <= 0:
                    # part finished
                    st.part_count += 1
                    st.last_cycle_time_s = round(st._current_cycle_len, 2)
                    st._holding_finished = True
                    # a completion at the last station == a part leaving the line
                    if st is self.stations[-1]:
                        pid, entry = (self._in_line.popleft() if self._in_line
                                      else (self._next_part_id, self.sim_time_s))
                        self._pending_parts.append({
                            "part_id": f"P{pid}",
                            "entry_ts_sim": entry,
                            "lead_time_s": round(self.sim_time_s - entry, 2),
                        })

        # Phase B: resolve material movement, DOWNSTREAM -> UPSTREAM so a slot
        # freed this tick is visible to the station feeding it.
        for i in range(len(self.stations) - 1, -1, -1):
            st = self.stations[i]
            if st.state in (MachineState.down, MachineState.maintenance):
                continue

            # 1) hand off a finished part if we're holding one
            if st._holding_finished:
                if self._downstream_has_space(i):
                    self._push_downstream(i)
                    st._holding_finished = False
                    st.part_present = False
                else:
                    st.part_present = True
                    self._transition(st, MachineState.blocked, reason="downstream_full")
                    continue

            # 2) if free — not holding a finished part AND not mid-cycle — pull next
            mid_cycle = st._remaining_s > 1e-9 and not st._holding_finished
            if not st._holding_finished and not mid_cycle:
                if self._upstream_has_part(i):
                    self._take_upstream(i)
                    st._current_cycle_len = st._sample_cycle()
                    st._remaining_s = st._current_cycle_len
                    st.part_present = True
                    if i == 0:  # a fresh part enters the line at the first station
                        self._in_line.append((self._next_part_id, self.sim_time_s))
                        self._next_part_id += 1
                    self._transition(st, MachineState.running, reason="part_in")
                else:
                    st.part_present = False
                    self._transition(st, MachineState.starved, reason="starved")

    # -- payload builders -------------------------------------------------- #
    def _sim_ts(self) -> str:
        return (
            (self.base_time + timedelta(seconds=self.sim_time_s))
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )

    def wall_drift_s(self) -> float:
        """How far the simulated clock trails wall-clock (positive = behind).

        Grows when the process is frozen (e.g. laptop sleep) because sim_time_s
        stops advancing while wall-clock keeps moving.
        """
        expected = self.base_time + timedelta(seconds=self.sim_time_s)
        return (datetime.now(timezone.utc) - expected).total_seconds()

    def resync_clock(self) -> None:
        """Re-anchor base_time so sim timestamps == wall-clock now.

        In real-time mode (--speed 1, mixed with live feeds) the KPI window is
        wall-clock anchored to the newest sample (the real machines). If a freeze
        leaves the sim clock behind, every sim row falls outside that window and
        KPIs read 0. Re-anchoring closes the gap so sim data lands in-window.
        Only for real-time mode — accelerated runs (--speed>1) must NOT resync.
        """
        self.base_time = datetime.now(timezone.utc) - timedelta(seconds=self.sim_time_s)

    def telemetry_messages(self):
        ts = self._sim_ts()
        for st in self.stations:
            msg = Telemetry(
                ts=ts,
                line_id=self.scenario.line_id,
                station_id=st.cfg.id,
                current_a=round(st.current_reading(), 3),
                part_present=st.part_present,
                part_count=st.part_count,
                cycle_time_s=st.last_cycle_time_s,
                state=st.state,
                source=SourceType.simulated,   # honest provenance: this is the emulator
            )
            topic = telemetry_topic(self.scenario.line_id, st.cfg.id)
            yield topic, msg

    def raw_messages(self):
        """Route-B raw signals only (current + IR) — what a retrofit ESP32 emits.
        State is NOT included; it's inferred downstream by services/inference."""
        ts = self._sim_ts()
        for st in self.stations:
            msg = RawTelemetry(
                ts=ts,
                line_id=self.scenario.line_id,
                station_id=st.cfg.id,
                current_a=round(st.current_reading(), 3),
                part_present=st.part_present,
                part_count=st.part_count,
            )
            yield raw_topic(self.scenario.line_id, st.cfg.id), msg

    def part_messages(self):
        ts = self._sim_ts()
        for p in self._pending_parts:
            entry_iso = (
                (self.base_time + timedelta(seconds=p["entry_ts_sim"]))
                .isoformat(timespec="seconds").replace("+00:00", "Z")
            )
            msg = PartExit(ts=ts, line_id=self.scenario.line_id, part_id=p["part_id"],
                           entry_ts=entry_iso, lead_time_s=p["lead_time_s"])
            yield part_topic(self.scenario.line_id), msg

    def drain_events(self):
        ts = self._sim_ts()
        for e in self._pending_events:
            msg = Event(
                ts=ts,
                line_id=self.scenario.line_id,
                station_id=e["station_id"],
                event_type=e["event_type"],
                reason=e["reason"],
                duration_s=e["duration_s"],
            )
            topic = event_topic(self.scenario.line_id, e["station_id"])
            yield topic, msg


# --------------------------------------------------------------------------- #
# Runner
# --------------------------------------------------------------------------- #
_STATE_TAG = {
    MachineState.running: "RUN",
    MachineState.idle: "IDL",
    MachineState.blocked: "BLK",
    MachineState.down: "DWN",
    MachineState.starved: "STV",
    MachineState.maintenance: "MNT",
    MachineState.offline: "OFF",
}


def _compact_line(sim: LineSimulator) -> str:
    mm = int(sim.sim_time_s) // 60
    ss = int(sim.sim_time_s) % 60
    cells = []
    for st in sim.stations:
        cells.append(f"{st.cfg.id} {_STATE_TAG[st.state]} {st.part_count:>4}")
    thru = sim.stations[-1].part_count
    return f"t={mm:02d}:{ss:02d} | " + " | ".join(cells) + f" || out={thru}"


def run(args) -> int:
    scenario = load_scenario(args.scenario)
    print(
        f"[emulator] scenario='{scenario.name}'  line={scenario.line_id}  "
        f"stations={len(scenario.stations)}  tick={scenario.tick_hz}Hz  "
        f"seed={scenario.seed}",
        file=sys.stderr,
    )
    if scenario.description:
        print(f"[emulator] {scenario.description}", file=sys.stderr)

    # publisher selection
    if args.dry_run:
        publisher: Publisher = PrintPublisher(show=args.print)
        print("[emulator] DRY RUN — not connecting to a broker.", file=sys.stderr)
    else:
        publisher = MqttPublisher(
            host=args.broker,
            port=args.port,
            username=os.getenv("MQTT_USERNAME", ""),
            password=os.getenv("MQTT_PASSWORD", ""),
        )
        print(f"[emulator] publishing to mqtt://{args.broker}:{args.port}", file=sys.stderr)
        if args.print:
            publisher = _Tee(publisher, PrintPublisher(show=True))

    sim = LineSimulator(scenario)

    dt_sim = args.speed / scenario.tick_hz          # simulated seconds per tick
    wall_sleep = 0.0 if args.no_sleep else (1.0 / scenario.tick_hz)
    # Real-time mode keeps sim timestamps on wall-clock so they share a time base
    # with live feeds; re-anchor if a freeze (sleep) drifts them out of the window.
    realtime = (args.speed == 1.0) and not args.no_sleep
    RESYNC_THRESHOLD_S = 5.0

    stop = {"flag": False}

    def _handle_sigint(signum, frame):  # noqa: ARG001
        stop["flag"] = True

    signal.signal(signal.SIGINT, _handle_sigint)
    signal.signal(signal.SIGTERM, _handle_sigint)

    tick = 0
    n_telemetry = 0
    n_events = 0
    try:
        while not stop["flag"]:
            sim.advance(dt_sim)   # fine internal steps -> speed-independent physics

            # If the process was frozen (laptop sleep), the sim clock now trails
            # wall-clock; re-anchor so this tick's telemetry timestamps == now and
            # stay inside the wall-clock KPI window shared with the live feeds.
            if realtime and sim.wall_drift_s() > RESYNC_THRESHOLD_S:
                drift = sim.wall_drift_s()
                sim.resync_clock()
                if not args.quiet:
                    print(f"  [clock] re-synced to wall-clock (was {drift:.0f}s behind)",
                          file=sys.stderr)

            if args.raw:
                # Route B: publish raw signals only; state is inferred downstream
                for topic, msg in sim.raw_messages():
                    publisher.publish(topic, msg.model_dump_json())
                    n_telemetry += 1
                sim.drain_events()  # discard (not published in raw mode)
                if not args.quiet and not args.print:
                    print(_compact_line(sim), file=sys.stderr)
                tick += 1
                if args.max_ticks and tick >= args.max_ticks:
                    break
                if args.sim_seconds and sim.sim_time_s >= args.sim_seconds:
                    break
                if wall_sleep:
                    time.sleep(wall_sleep)
                continue

            for topic, msg in sim.telemetry_messages():
                publisher.publish(topic, msg.model_dump_json())
                n_telemetry += 1

            for topic, msg in sim.part_messages():
                publisher.publish(topic, msg.model_dump_json())

            for topic, msg in sim.drain_events():
                publisher.publish(topic, msg.model_dump_json())
                n_events += 1
                if not args.quiet:
                    print(
                        f"  event: {msg.station_id} -> {msg.event_type.value} "
                        f"({msg.reason}, prev_state {msg.duration_s}s)",
                        file=sys.stderr,
                    )

            if not args.quiet and not args.print:
                print(_compact_line(sim), file=sys.stderr)

            tick += 1
            if args.max_ticks and tick >= args.max_ticks:
                break
            if args.sim_seconds and sim.sim_time_s >= args.sim_seconds:
                break
            if wall_sleep:
                time.sleep(wall_sleep)
    finally:
        publisher.close()

    print(
        f"[emulator] stopped after {tick} ticks "
        f"({sim.sim_time_s:.0f}s sim). telemetry={n_telemetry} events={n_events}. "
        f"final output={sim.stations[-1].part_count} parts.",
        file=sys.stderr,
    )
    return 0


class _Tee(Publisher):
    def __init__(self, *pubs: Publisher):
        self._pubs = pubs

    def publish(self, topic: str, payload: str) -> None:
        for p in self._pubs:
            p.publish(topic, payload)

    def close(self) -> None:
        for p in self._pubs:
            p.close()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Factory cell emulator -> MQTT (build plan Phase 1).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--scenario", default="normal",
                   help="scenario name (in scenarios/) or path to a .yaml")
    p.add_argument("--broker", default=os.getenv("MQTT_HOST", "localhost"),
                   help="MQTT broker host")
    p.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")),
                   help="MQTT broker port")
    p.add_argument("--speed", type=float, default=1.0,
                   help="sim-time multiplier (2 = twice as fast as real time)")
    p.add_argument("--no-sleep", action="store_true",
                   help="don't sleep between ticks (generate data as fast as possible)")
    p.add_argument("--max-ticks", type=int, default=0,
                   help="stop after N ticks (0 = run forever)")
    p.add_argument("--sim-seconds", type=float, default=0.0,
                   help="stop after N simulated seconds (0 = run forever)")
    p.add_argument("--print", action="store_true",
                   help="print every telemetry/event payload (JSON)")
    p.add_argument("--quiet", action="store_true",
                   help="suppress the per-tick status line and event log")
    p.add_argument("--raw", action="store_true",
                   help="Route B: publish RAW signals (current+IR) to .../raw instead "
                        "of full telemetry — emulates a retrofit ESP32 for services/inference")
    p.add_argument("--dry-run", action="store_true",
                   help="don't connect to a broker; just generate (optionally --print)")
    p.add_argument("--list-scenarios", action="store_true",
                   help="list available scenarios and exit")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.list_scenarios:
        names = list_scenarios()
        print("Available scenarios:")
        for n in names:
            try:
                sc = load_scenario(n)
                print(f"  {n:12s} — {sc.description or '(no description)'}")
            except Exception as exc:  # noqa: BLE001
                print(f"  {n:12s} — <error: {exc}>")
        return 0
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
