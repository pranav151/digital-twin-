"""
Part 13's state engine. This is the one piece that both real connectors and
the simulator connector feed identically -- it has no idea which source an
event came from except the `source` tag it forwards to the frontend for
labeling (Part 28: never let the UI present simulated data as real).
"""
from __future__ import annotations
import asyncio
import logging
from typing import Callable, Awaitable

from schema import TwinEvent, StationSnapshot, MachineState

log = logging.getLogger("twin_state")

Broadcaster = Callable[[dict], Awaitable[None]]


class DigitalTwinState:
    def __init__(self):
        self.stations: dict[str, StationSnapshot] = {}
        self._broadcasters: list[Broadcaster] = []

    def add_broadcaster(self, fn: Broadcaster) -> None:
        self._broadcasters.append(fn)

    async def consume(self, queue: "asyncio.Queue[TwinEvent]") -> None:
        while True:
            event = await queue.get()
            self._apply(event)
            await self._broadcast(event)

    def _apply(self, event: TwinEvent) -> None:
        snap = self.stations.setdefault(event.station_id, StationSnapshot(station_id=event.station_id))
        snap.last_updated = event.timestamp
        snap.source = event.source
        if event.state is not None:
            snap.state = event.state
        if event.cycle_time_s is not None:
            snap.cycle_time_s = event.cycle_time_s
        if event.buffer_level is not None:
            snap.buffer_level = event.buffer_level
        if event.part_completed and event.parts_count is not None:
            snap.parts_count = event.parts_count
        elif event.part_completed:
            snap.parts_count += 1

    async def _broadcast(self, event: TwinEvent) -> None:
        snap = self.stations[event.station_id]
        payload = {
            "type": "station_update",
            "station_id": snap.station_id,
            "state": snap.state.value,
            "parts_count": snap.parts_count,
            "cycle_time_s": snap.cycle_time_s,
            "buffer_level": snap.buffer_level,
            "source": snap.source.value,  # <- frontend badge: REAL_OPCUA / SIMULATED / etc.
            "timestamp": snap.last_updated.isoformat(),
        }
        for fn in self._broadcasters:
            try:
                await fn(payload)
            except Exception:
                log.exception("broadcaster failed")

    def bottleneck(self) -> str | None:
        """Minimal version of Part 21's explainable bottleneck: the station with
        the highest observed cycle time among currently RUNNING/BLOCKED stations."""
        candidates = [s for s in self.stations.values()
                      if s.state in (MachineState.RUNNING, MachineState.BLOCKED) and s.cycle_time_s]
        if not candidates:
            return None
        worst = max(candidates, key=lambda s: s.cycle_time_s)
        return worst.station_id
