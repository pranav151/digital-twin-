"""
Normalized digital-twin schema.

Every data source (OPC UA, MTConnect, SimPy simulator, later a real MES/SCADA feed)
must produce events in THIS shape before they reach the twin state engine. The
frontend, the state engine, and the historian never see anything else — this is
what makes the source swappable per your Part 15/16.
"""
from __future__ import annotations
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Literal
from pydantic import BaseModel, Field


class MachineState(str, Enum):
    RUNNING = "RUNNING"
    IDLE = "IDLE"
    BLOCKED = "BLOCKED"
    STARVED = "STARVED"
    DOWN = "DOWN"
    MAINTENANCE = "MAINTENANCE"
    OFFLINE = "OFFLINE"


class QualityStatus(str, Enum):
    GOOD = "GOOD"
    SCRAP = "SCRAP"
    REWORK = "REWORK"
    UNKNOWN = "UNKNOWN"


class SourceType(str, Enum):
    """Every event says where it really came from — Part 28's honesty requirement,
    enforced in the schema instead of left to documentation."""
    REAL_OPCUA = "REAL_OPCUA"
    REAL_MTCONNECT = "REAL_MTCONNECT"
    HISTORICAL_REPLAY = "HISTORICAL_REPLAY"
    SIMULATED = "SIMULATED"


class TwinEvent(BaseModel):
    """One normalized observation. This is the ONLY object that crosses the
    connector -> state-engine boundary, from any source."""
    plant_id: str
    line_id: str
    station_id: str
    asset_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source: SourceType

    state: Optional[MachineState] = None
    cycle_time_s: Optional[float] = None
    parts_count: Optional[int] = None          # cumulative counter, if the source gives one
    part_completed: bool = False                # true on a single CYCLE_COMPLETED event
    buffer_level: Optional[int] = None
    quality_status: Optional[QualityStatus] = None

    # free-form passthrough for anything source-specific you don't want to lose
    raw: Optional[dict] = None


class PartEvent(BaseModel):
    """Part 9's part-level record. Populate directly if the source gives you
    part IDs (RFID/MES); otherwise derive it from consecutive part_completed
    TwinEvents at a station (see twin_state.py)."""
    part_id: str
    station_id: str
    line_id: str
    entry_ts: Optional[datetime] = None
    exit_ts: Optional[datetime] = None
    waiting_time_s: Optional[float] = None
    processing_time_s: Optional[float] = None
    quality_status: QualityStatus = QualityStatus.UNKNOWN
    next_station: Optional[str] = None


class StationSnapshot(BaseModel):
    """What the frontend actually renders per station — the twin engine's
    current-state view, rebuilt from the TwinEvent stream."""
    station_id: str
    state: MachineState = MachineState.OFFLINE
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    parts_count: int = 0
    cycle_time_s: Optional[float] = None
    ideal_cycle_time_s: Optional[float] = None
    buffer_level: int = 0
    utilization_pct: Optional[float] = None
    source: SourceType = SourceType.SIMULATED
