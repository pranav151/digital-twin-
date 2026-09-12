"""
The "technically honest fallback" connector: a live event generator that
produces TwinEvents through the identical schema/queue as the OPC UA and
MTConnect connectors, tagged SourceType.SIMULATED so nothing downstream can
mistake it for real data (Part 28's requirement, enforced in the schema).

It's driven by a station_params.json you calibrate from real data (Bosch /
NASA-PHM — see calibrate_from_dataset.py) instead of invented numbers, and it
implements the blocking/starving logic from your Part 8: a station can't
start its next cycle until the downstream buffer has room, and starves if
the upstream buffer is empty.
"""
from __future__ import annotations
import asyncio
import json
import random
from datetime import datetime, timezone
from pathlib import Path

from connectors.base import DataConnector
from schema import TwinEvent, MachineState, SourceType


class SimulatorConnector(DataConnector):
    def __init__(self, out_queue, plant_id: str, line_id: str, params_path: str,
                 buffer_capacity: int = 5, tick_seconds: float = 1.0, sim_dt_s: float | None = None):
        super().__init__(out_queue)
        self.plant_id = plant_id
        self.line_id = line_id
        self.tick_seconds = tick_seconds          # real wall-clock sleep per tick
        self.sim_dt_s = sim_dt_s if sim_dt_s is not None else tick_seconds  # simulated seconds advanced per tick
        self.buffer_capacity = buffer_capacity

        params = json.loads(Path(params_path).read_text())
        self.stations = params["stations"]  # ordered list: [{"id": "S1", "cycle_mean_s": .., "cycle_std_s": .., "fail_rate_per_hr": ..}, ...]
        self.buffers = {s["id"]: buffer_capacity // 2 for s in self.stations[:-1]}  # buffer AFTER each non-final station
        self.remaining = {s["id"]: self._sample_cycle_time(s) for s in self.stations}
        self.parts_count = {s["id"]: 0 for s in self.stations}
        self.state = {s["id"]: MachineState.RUNNING for s in self.stations}

    def _sample_cycle_time(self, station: dict) -> float:
        return max(0.5, random.gauss(station["cycle_mean_s"], station.get("cycle_std_s", 0.0)))

    async def run(self) -> None:
        while not self._stop.is_set():
            await self._tick()
            await self._sleep_or_stop(self.tick_seconds)

    async def _sleep_or_stop(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def _tick(self) -> None:
        for i, station in enumerate(self.stations):
            sid = station["id"]
            upstream_ok = i == 0 or self.buffers[self.stations[i - 1]["id"]] > 0
            downstream_ok = i == len(self.stations) - 1 or self.buffers[sid] < self.buffer_capacity

            if not upstream_ok:
                self.state[sid] = MachineState.STARVED
                continue
            if not downstream_ok:
                self.state[sid] = MachineState.BLOCKED
                continue

            self.state[sid] = MachineState.RUNNING
            self.remaining[sid] -= self.sim_dt_s
            if self.remaining[sid] <= 0:
                # cycle complete: consume from upstream buffer, produce to own buffer
                if i > 0:
                    self.buffers[self.stations[i - 1]["id"]] -= 1
                if i < len(self.stations) - 1:
                    self.buffers[sid] += 1
                self.parts_count[sid] += 1
                self.remaining[sid] = self._sample_cycle_time(station)

                await self.emit(TwinEvent(
                    plant_id=self.plant_id, line_id=self.line_id, station_id=sid,
                    source=SourceType.SIMULATED, timestamp=datetime.now(timezone.utc),
                    state=self.state[sid], cycle_time_s=station["cycle_mean_s"],
                    parts_count=self.parts_count[sid], part_completed=True,
                    buffer_level=self.buffers.get(sid),
                ))
                continue

            # non-completing tick: still publish current state so the frontend's
            # BLOCKED/STARVED indicators update in near-real-time, not just on completion
            await self.emit(TwinEvent(
                plant_id=self.plant_id, line_id=self.line_id, station_id=sid,
                source=SourceType.SIMULATED, timestamp=datetime.now(timezone.utc),
                state=self.state[sid], buffer_level=self.buffers.get(sid),
            ))
