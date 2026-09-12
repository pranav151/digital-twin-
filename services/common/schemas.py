"""Pydantic message schemas — the payload contract (build plan Section 6.1).

These models validate every message at the point of publishing (emulator /
firmware) and at the point of ingestion, so a malformed payload can never
silently corrupt the historian. Python 3.9 compatible (uses typing.Optional,
not PEP-604 unions, so it also runs on the system interpreter).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class MachineState(str, Enum):
    """Canonical machine states the whole system reasons about (spec §6.B: 7 states)."""

    idle = "idle"                # powered, no work scheduled
    running = "running"          # actively processing a part
    blocked = "blocked"          # finished a part but downstream is full
    down = "down"               # unplanned stop / fault / breakdown
    starved = "starved"          # waiting for an upstream part
    maintenance = "maintenance"  # planned maintenance stop
    offline = "offline"          # no telemetry (derived downstream, not emitted)


# InfluxDB stores an integer state_code (plan Section 6.2), not the string.
STATE_CODE = {
    MachineState.idle: 0,
    MachineState.running: 1,
    MachineState.blocked: 2,
    MachineState.down: 3,
    MachineState.starved: 4,
    MachineState.maintenance: 5,
    MachineState.offline: 6,
}
CODE_STATE = {v: k for k, v in STATE_CODE.items()}


def state_code(state) -> int:
    """MachineState | str -> integer code for the historian."""
    return STATE_CODE[MachineState(state)]


def utcnow_iso() -> str:
    """UTC timestamp as 'YYYY-MM-DDTHH:MM:SSZ' (matches plan example payloads)."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


class SourceType(str, Enum):
    """Provenance of a telemetry sample — honest labeling of real vs synthetic data.

    Every sample carries where it came from so the UI can badge a live cell as
    REAL (a physical machine, via OPC-UA / MTConnect) versus SIMULATED (our
    emulator) versus a HISTORICAL replay. Lowercase to match MachineState.
    """

    simulated = "simulated"            # our SimPy emulator (edge/emulator)
    real_opcua = "real_opcua"          # a real/demo PLC via OPC-UA (services/connectors)
    real_mtconnect = "real_mtconnect"  # a real/demo CNC via an MTConnect agent
    real_modbus = "real_modbus"        # a real/demo PLC via Modbus TCP (services/connectors)
    historical_replay = "historical_replay"  # replayed from the historian


class EventType(str, Enum):
    idle = "idle"
    running = "running"
    blocked = "blocked"
    down = "down"
    starved = "starved"
    maintenance = "maintenance"


class Telemetry(BaseModel):
    """~1 Hz per-station telemetry (plan Section 6.1 telemetry payload)."""

    ts: str = Field(default_factory=utcnow_iso)
    line_id: str
    station_id: str
    current_a: float             # Route B raw signal (clamp-on CT)
    part_present: bool           # IR / proximity sensor
    part_count: int              # cumulative good parts completed
    cycle_time_s: Optional[float] = None   # last completed cycle
    state: MachineState          # Route A gives directly; Route B inferred (Phase 8)
    # Provenance: defaults to simulated so the emulator needs no change; real
    # hardware connectors (services/connectors) set real_opcua / real_mtconnect.
    source: SourceType = SourceType.simulated
    # Optional real machine signals a connector may carry (e.g. MTConnect spindle
    # RotaryVelocity). None when the source doesn't provide them.
    spindle_rpm: Optional[float] = None

    def influx_state_code(self) -> int:
        return state_code(self.state)


class RawTelemetry(BaseModel):
    """Route B raw signals from a retrofit ESP32 on a legacy machine (Phase 8).

    No state — the machine is un-instrumented; state is INFERRED downstream by
    services/inference (novelty #1). Published to factory/{line}/{station}/raw.
    """

    ts: str = Field(default_factory=utcnow_iso)
    line_id: str
    station_id: str
    current_a: float             # clamp-on CT (SCT-013) RMS current
    part_present: bool = False   # IR / proximity sensor
    part_count: int = 0          # cumulative IR count


class PartExit(BaseModel):
    """Emitted when a finished part leaves the line (per-part traceability, spec §6.C).
    Published to factory/{line}/part."""

    ts: str = Field(default_factory=utcnow_iso)
    line_id: str
    part_id: str
    entry_ts: str          # when the part entered the line (at the first station)
    lead_time_s: float     # total time on the line (processing + waiting)


class Event(BaseModel):
    """Published on a state change / stoppage (plan Section 6.1 event payload)."""

    ts: str = Field(default_factory=utcnow_iso)
    line_id: str
    station_id: str
    event_type: EventType
    reason: Optional[str] = None
    duration_s: Optional[float] = None   # duration of the state that just ended
