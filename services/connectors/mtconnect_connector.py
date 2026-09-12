"""MTConnect connector — polls an MTConnect agent and republishes to our MQTT bus.

MTConnect is what real CNC shops expose (Haas, Okuma, Mazak, Fanuc-equipped cells)
via a REST agent with /probe, /current, /sample. Verified live endpoint to develop
against, no shop floor required:  https://demo.mtconnect.org  (simulated CNC data,
but the real MTConnect schema a shop's agent would serve).

Polls /current on an interval (agents update on the order of seconds, which is
plenty). Map the agent's device names to your stations via MTCONNECT_DEVICE_MAP:
  MTCONNECT_DEVICE_MAP='{"GFAgie01":"S2","Mazak01":"S3"}'
GET {agent}/probe to list the device names first.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional
from xml.etree import ElementTree

import httpx

from services.common import MachineState, SourceType
from services.connectors.base import MqttConnector

log = logging.getLogger("connector.mtconnect")

# MTConnect Execution -> our lowercase MachineState.
# UNAVAILABLE is intentionally NOT mapped: we skip publishing so the station goes
# stale and LiveHub marks it offline — consistent with our rule that `offline` is
# derived downstream, never emitted by a source.
EXECUTION_TO_STATE = {
    "ACTIVE": MachineState.running,
    "READY": MachineState.idle,
    "STOPPED": MachineState.idle,
    "PROGRAM_STOPPED": MachineState.idle,
    "INTERRUPTED": MachineState.blocked,
    "FEED_HOLD": MachineState.blocked,
}


def _default_device_map() -> dict:
    raw = os.getenv("MTCONNECT_DEVICE_MAP", "").strip()
    if not raw:
        return {}
    try:
        return dict(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        log.error("bad MTCONNECT_DEVICE_MAP (%s): %s", exc, raw)
        return {}


class MtConnectConnector(MqttConnector):
    source = SourceType.real_mtconnect

    def __init__(
        self,
        agent_base_url: str,
        line_id: str = "L1",
        device_to_station: Optional[dict] = None,
        poll_seconds: float = 2.0,
    ):
        super().__init__(line_id=line_id, client_id="connector-mtconnect")
        self.agent_base_url = agent_base_url.rstrip("/")
        self.device_to_station = device_to_station or _default_device_map()
        self.poll_seconds = poll_seconds

    async def run(self) -> None:
        if not self.device_to_station:
            log.warning(
                "MTCONNECT_DEVICE_MAP is empty — polling but mapping nothing. "
                "GET %s/probe to list device names, then map them to S1-S4.",
                self.agent_base_url,
            )
        async with httpx.AsyncClient(timeout=10.0) as client:
            while not self._stop.is_set():
                try:
                    resp = await client.get(f"{self.agent_base_url}/current")
                    resp.raise_for_status()
                    self._handle_current(resp.text)
                except Exception as exc:  # noqa: BLE001 - keep polling through transient failures
                    log.warning("MTConnect poll failed: %s", exc)
                await self._sleep_or_stop(self.poll_seconds)

    def _handle_current(self, xml_text: str) -> None:
        root = ElementTree.fromstring(xml_text)
        # Match by local tag name so we're agnostic to the MTConnectStreams schema version.
        for ds in root.iter():
            if ds.tag.split("}")[-1] != "DeviceStream":
                continue
            station_id = self.device_to_station.get(ds.get("name", ""))
            if not station_id:
                continue  # a device on the agent we haven't mapped to a station

            state: Optional[MachineState] = None
            part_count: Optional[int] = None
            spindle_rpm: Optional[float] = None
            for elem in ds.iter():
                tag = elem.tag.split("}")[-1]
                text = (elem.text or "").strip()
                if tag == "Execution":
                    state = EXECUTION_TO_STATE.get(text)  # UNAVAILABLE/unknown -> None
                elif tag == "PartCount":
                    try:
                        part_count = int(float(text))
                    except (TypeError, ValueError):
                        pass
                elif tag == "RotaryVelocity" and elem.get("subType") == "ACTUAL":
                    # a device may have several spindles; the live one is the fastest.
                    try:
                        rpm = float(text)
                        spindle_rpm = rpm if spindle_rpm is None else max(spindle_rpm, rpm)
                    except (TypeError, ValueError):
                        pass

            if state is None:
                continue  # UNAVAILABLE or unmapped execution -> let it go stale -> offline
            self.publish_station(station_id, state=state, part_count=part_count,
                                 spindle_rpm=spindle_rpm)
