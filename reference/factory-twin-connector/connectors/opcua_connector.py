"""
OPC UA connector, built on asyncua (the maintained async OPC UA client library).

Verified endpoints you can point this at today, no factory required:
  - opc.tcp://milo.digitalpetri.com:62541/milo          (Eclipse Milo public demo, anonymous OK)
  - opc.tcp://opcua.demo-this.com:51210/UA/SampleServer  (OPC Labs public sample server)
  - a locally-run umati Sample-Server-asyncio container (github.com/umati/Sample-Server-asyncio)
  - a locally-run Azure-Samples/iot-edge-opc-plc simulator (your own realistic PLC stand-in)
  - later: a real Kepware/Ignition OPC UA gateway sitting in front of a real PLC — same code path

node_map below is your Part 6 asset-ID mapping: OPC UA NodeId -> (station_id, field).
Populate it once you know the address space of whatever server you point this at
(browse it first — asyncua ships a `uabrowse` / `uals` CLI for exactly that).
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional

from asyncua import Client, ua
from asyncua.common.subscription import DataChangeNotif

from connectors.base import DataConnector
from schema import TwinEvent, MachineState, SourceType

log = logging.getLogger("connector.opcua")

# Example mapping — replace node ids with real ones from your target server's
# address space (asyncua's browse tools, or UaExpert, will show you these).
NODE_TO_STATION_FIELD: dict[str, tuple[str, str]] = {
    # "ns=2;i=1001": ("S1", "state"),
    # "ns=2;i=1002": ("S1", "cycle_time_s"),
    # "ns=2;i=1003": ("S1", "parts_count"),
}

STATE_VALUE_MAP = {
    0: MachineState.IDLE,
    1: MachineState.RUNNING,
    2: MachineState.DOWN,
    3: MachineState.MAINTENANCE,
}


class OpcUaConnector(DataConnector):
    def __init__(self, out_queue, endpoint_url: str, plant_id: str, line_id: str,
                 node_map: Optional[dict] = None):
        super().__init__(out_queue)
        self.endpoint_url = endpoint_url
        self.plant_id = plant_id
        self.line_id = line_id
        self.node_map = node_map or NODE_TO_STATION_FIELD

    async def run(self) -> None:
        async with Client(url=self.endpoint_url) as client:
            log.info("connected to %s", self.endpoint_url)
            handler = self._SubHandler(self)
            sub = await client.create_subscription(500, handler)  # 500ms publish interval
            for node_str in self.node_map:
                node = client.get_node(node_str)
                await sub.subscribe_data_change(node)
            # Keep the subscription alive until stop() is called.
            while not self._stop.is_set():
                await self._sleep_or_stop(1.0)
            await sub.delete()

    async def _sleep_or_stop(self, seconds: float) -> None:
        import asyncio
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except TimeoutError:
            pass

    class _SubHandler:
        """asyncua calls datachange_notification() on every subscribed value change —
        this is where a raw OPC UA tag update becomes a normalized TwinEvent."""

        def __init__(self, outer: "OpcUaConnector"):
            self.outer = outer

        def datachange_notification(self, node, val, data: DataChangeNotif):
            node_str = node.nodeid.to_string()
            mapping = self.outer.node_map.get(node_str)
            if not mapping:
                return
            station_id, field = mapping
            event = TwinEvent(
                plant_id=self.outer.plant_id,
                line_id=self.outer.line_id,
                station_id=station_id,
                source=SourceType.REAL_OPCUA,
                timestamp=datetime.now(timezone.utc),
                raw={"node": node_str, "value": val},
            )
            if field == "state":
                event.state = STATE_VALUE_MAP.get(int(val), MachineState.OFFLINE)
            elif field == "cycle_time_s":
                event.cycle_time_s = float(val)
            elif field == "parts_count":
                event.parts_count = int(val)
                event.part_completed = True
            # fire-and-forget the coroutine from this sync callback
            import asyncio
            asyncio.create_task(self.outer.emit(event))
