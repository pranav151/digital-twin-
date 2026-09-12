"""Shared contracts for the Real-Time Factory Digital Twin.

Everything (emulator, ingestion, backend, real firmware) decouples through the
schemas and topic strings defined here. See Section 6 of the build plan.
"""

from .schemas import (  # noqa: F401
    MachineState,
    SourceType,
    Telemetry,
    RawTelemetry,
    Event,
    EventType,
    PartExit,
    state_code,
    STATE_CODE,
    utcnow_iso,
)
from .topics import (  # noqa: F401
    telemetry_topic,
    event_topic,
    raw_topic,
    part_topic,
    TELEMETRY_WILDCARD,
    EVENT_WILDCARD,
    RAW_WILDCARD,
    PART_WILDCARD,
)

__all__ = [
    "MachineState",
    "SourceType",
    "Telemetry",
    "RawTelemetry",
    "Event",
    "EventType",
    "PartExit",
    "state_code",
    "STATE_CODE",
    "utcnow_iso",
    "telemetry_topic",
    "event_topic",
    "raw_topic",
    "part_topic",
    "TELEMETRY_WILDCARD",
    "EVENT_WILDCARD",
    "RAW_WILDCARD",
    "PART_WILDCARD",
]
