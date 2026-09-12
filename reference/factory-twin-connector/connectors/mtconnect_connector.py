"""
MTConnect connector. MTConnect is the standard real CNC shops actually expose
(Haas, Okuma, Mazak, Fanuc-equipped cells all speak it) via a REST agent with
/probe, /current, /sample endpoints -- see mtconnect_spec below for how the
XML maps into TwinEvents.

Verified live endpoint to develop against: https://demo.mtconnect.org
(simulated CNC data, but the real MTConnect schema -- same one a real shop's
agent would serve).

This polls /current on an interval rather than holding a long-poll/WebSocket
connection open, which is simpler and plenty fast enough (agents update on
the order of seconds, not milliseconds, for most DataItems that matter here).
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from xml.etree import ElementTree

import httpx

from connectors.base import DataConnector
from schema import TwinEvent, MachineState, SourceType

log = logging.getLogger("connector.mtconnect")

MTCONNECT_NS = {"m": "urn:mtconnect.org:MTConnectStreams:2.0"}

EXECUTION_TO_STATE = {
    "ACTIVE": MachineState.RUNNING,
    "READY": MachineState.IDLE,
    "STOPPED": MachineState.IDLE,
    "INTERRUPTED": MachineState.BLOCKED,
    "UNAVAILABLE": MachineState.OFFLINE,
}


class MtConnectConnector(DataConnector):
    def __init__(self, out_queue, agent_base_url: str, plant_id: str, line_id: str,
                 device_to_station: dict[str, str], poll_seconds: float = 2.0):
        super().__init__(out_queue)
        self.agent_base_url = agent_base_url.rstrip("/")
        self.plant_id = plant_id
        self.line_id = line_id
        self.device_to_station = device_to_station  # MTConnect device name -> your station_id
        self.poll_seconds = poll_seconds

    async def run(self) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            while not self._stop.is_set():
                try:
                    resp = await client.get(f"{self.agent_base_url}/current")
                    resp.raise_for_status()
                    await self._handle_current(resp.text)
                except Exception as exc:  # keep polling even if one request fails
                    log.warning("MTConnect poll failed: %s", exc)
                await self._sleep_or_stop(self.poll_seconds)

    async def _sleep_or_stop(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass

    async def _handle_current(self, xml_text: str) -> None:
        root = ElementTree.fromstring(xml_text)
        for device_stream in root.iter("{urn:mtconnect.org:MTConnectStreams:2.0}DeviceStream"):
            device_name = device_stream.get("name", "")
            station_id = self.device_to_station.get(device_name)
            if not station_id:
                continue  # a device on the agent we haven't mapped to a station yet

            event = TwinEvent(
                plant_id=self.plant_id,
                line_id=self.line_id,
                station_id=station_id,
                source=SourceType.REAL_MTCONNECT,
                timestamp=datetime.now(timezone.utc),
            )

            for elem in device_stream.iter():
                tag = elem.tag.split("}")[-1]
                if tag == "Execution":
                    event.state = EXECUTION_TO_STATE.get((elem.text or "").strip(),
                                                           MachineState.OFFLINE)
                elif tag == "PartCount":
                    try:
                        event.parts_count = int(elem.text)
                        event.part_completed = True
                    except (TypeError, ValueError):
                        pass

            await self.emit(event)
