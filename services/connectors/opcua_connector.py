"""OPC-UA connector — subscribes to a PLC/gateway and republishes to our MQTT bus.

Point it at any OPC-UA server; verified public demos you can develop against with
no factory required:
  - opc.tcp://milo.digitalpetri.com:62541/milo   (Eclipse Milo public demo, anon OK)
  - a local Azure-Samples/iot-edge-opc-plc container (a realistic PLC stand-in)
  - later: a real Kepware/Ignition OPC-UA gateway in front of a real PLC — same code.

Configure the tag→station mapping via OPCUA_NODE_MAP (JSON), e.g.
  OPCUA_NODE_MAP='{"ns=2;i=1001":["S1","state"],"ns=2;i=1002":["S1","cycle_time_s"]}'
Browse the server first (asyncua ships `uabrowse`/`uals`, or use UaExpert) to find
the NodeIds. `field` is one of: state | cycle_time_s | part_count | current_a | part_present.

`asyncua` is imported lazily so the dependency is only needed when this source is used.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from services.common import MachineState, SourceType
from services.connectors.base import MqttConnector

log = logging.getLogger("connector.opcua")

# Integer tag value -> our lowercase MachineState. Override per server if its
# encoding differs (this covers the common "RUNNING=1" convention).
STATE_VALUE_MAP = {
    0: MachineState.idle,
    1: MachineState.running,
    2: MachineState.down,
    3: MachineState.maintenance,
    4: MachineState.blocked,
    5: MachineState.starved,
}


def _default_node_map() -> dict:
    """OPCUA_NODE_MAP env -> {node_str: (station_id, field)}."""
    raw = os.getenv("OPCUA_NODE_MAP", "").strip()
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return {k: (v[0], v[1]) for k, v in d.items()}
    except Exception as exc:  # noqa: BLE001
        log.error("bad OPCUA_NODE_MAP (%s): %s", exc, raw)
        return {}


class OpcUaConnector(MqttConnector):
    source = SourceType.real_opcua

    def __init__(
        self,
        endpoint_url: str,
        line_id: str = "L1",
        node_map: Optional[dict] = None,
        pub_interval_ms: int = 500,
    ):
        super().__init__(line_id=line_id, client_id="connector-opcua")
        self.endpoint_url = endpoint_url
        self.node_map = node_map or _default_node_map()
        self.pub_interval_ms = pub_interval_ms

    async def run(self) -> None:
        from asyncua import Client  # lazy import: dep only needed for this source

        if not self.node_map:
            log.warning(
                "OPCUA_NODE_MAP is empty — connecting but nothing will be published. "
                "Browse %s and map NodeIds to (station, field) in OPCUA_NODE_MAP.",
                self.endpoint_url,
            )
        async with Client(url=self.endpoint_url) as client:
            log.info("connected to %s", self.endpoint_url)
            handler = _SubHandler(self)
            sub = await client.create_subscription(self.pub_interval_ms, handler)
            for node_str in self.node_map:
                try:
                    await sub.subscribe_data_change(client.get_node(node_str))
                except Exception as exc:  # noqa: BLE001
                    log.error("could not subscribe %s: %s", node_str, exc)
            while not self._stop.is_set():
                await self._sleep_or_stop(1.0)
            await sub.delete()


class _SubHandler:
    """asyncua calls datachange_notification() on each subscribed tag change.

    A raw OPC-UA update is mapped to a station+field and published as a full
    Telemetry on our MQTT bus (the base class fills in the station's other fields).
    paho's publish() is thread-safe with loop_start(), so we call it directly from
    this callback — no in-process queue.
    """

    def __init__(self, outer: OpcUaConnector):
        self.outer = outer

    def datachange_notification(self, node, val, data):  # noqa: ANN001
        node_str = node.nodeid.to_string()
        mapping = self.outer.node_map.get(node_str)
        if not mapping:
            return
        station_id, field = mapping
        kw: dict = {}
        if field == "state":
            st = STATE_VALUE_MAP.get(int(val))
            if st is None:
                log.warning("unmapped OPC-UA state value %r for %s", val, station_id)
                return
            kw["state"] = st
        elif field == "cycle_time_s":
            kw["cycle_time_s"] = float(val)
        elif field == "part_count":
            kw["part_count"] = int(val)
        elif field == "current_a":
            kw["current_a"] = float(val)
        elif field == "part_present":
            kw["part_present"] = bool(val)
        else:
            log.warning("unknown field %r in node map for %s", field, station_id)
            return
        try:
            self.outer.publish_station(station_id, **kw)
        except Exception as exc:  # noqa: BLE001
            log.error("publish failed for %s: %s", station_id, exc)
