"""DATA_SOURCE selection — one env var picks where live data comes from.

`build_connector(source)` returns the connector for a source, or None for the
"passive" sources (emulator / real hardware), which publish to MQTT on their own
so the backend just consumes the bus. This is called both by the backend startup
(backend/app/main.py) and by the standalone runner (python -m services.connectors).

Endpoints default to the verified public demos so `DATA_SOURCE=opcua` /
`DATA_SOURCE=mtconnect` works out of the box; override with OPCUA_ENDPOINT /
MTCONNECT_URL (and the *_MAP env vars) to point at your own gear.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from services.connectors.base import MqttConnector

log = logging.getLogger("connector.runner")

# Sources that publish to MQTT themselves — the backend need not launch anything.
PASSIVE = {"", "emulator", "simulated", "external", "mqtt", "hardware", "none", "off"}


def build_connector(source: str, line_id: Optional[str] = None) -> Optional[MqttConnector]:
    source = (source or "").strip().lower()
    line_id = line_id or os.getenv("CONNECTOR_LINE_ID", "L1")

    if source in PASSIVE:
        return None

    if source in ("opcua", "real_opcua"):
        from services.connectors.opcua_connector import OpcUaConnector
        endpoint = os.getenv("OPCUA_ENDPOINT", "opc.tcp://milo.digitalpetri.com:62541/milo")
        return OpcUaConnector(endpoint, line_id=line_id)

    if source in ("mtconnect", "real_mtconnect"):
        from services.connectors.mtconnect_connector import MtConnectConnector
        url = os.getenv("MTCONNECT_URL", "https://demo.mtconnect.org")
        poll = float(os.getenv("MTCONNECT_POLL_S", "2.0"))
        return MtConnectConnector(url, line_id=line_id, poll_seconds=poll)

    if source in ("modbus", "real_modbus"):
        from services.connectors.modbus_connector import ModbusConnector
        host = os.getenv("MODBUS_HOST", "localhost")
        port = int(os.getenv("MODBUS_PORT", "502"))
        poll = float(os.getenv("MODBUS_POLL_S", "1.0"))
        return ModbusConnector(host, port=port, line_id=line_id, poll_seconds=poll)

    raise ValueError(
        f"unknown DATA_SOURCE={source!r} (expected: emulator | opcua | mtconnect | modbus)"
    )


async def run_forever(connector: MqttConnector) -> None:
    connector.connect()
    try:
        await connector.run()
    finally:
        connector.close()
