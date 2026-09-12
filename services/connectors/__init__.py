"""Real-hardware data connectors (OPC-UA, MTConnect).

Each connector PUBLISHES services.common.Telemetry to the *same* MQTT topics the
emulator and the real ESP32 firmware use — differing only by the `source` field.
That shared contract (not a second event object or a second WebSocket) is what
lets DATA_SOURCE swap a real machine in with zero downstream rewrite: ingestion,
the historian, LiveHub, /ws/live, and the UI all stay exactly as they are.

Unlike the reference implementation this adapts, connectors here do NOT push a
`TwinEvent` onto an in-process asyncio.Queue — our bus is MQTT, so they publish
to it. See build plan Part 6 (Route A).
"""

from services.connectors.base import MqttConnector  # noqa: F401

__all__ = ["MqttConnector"]
