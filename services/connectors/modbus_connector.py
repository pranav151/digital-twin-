"""Modbus TCP connector — polls a PLC's registers and republishes to our MQTT bus.

Modbus TCP is the most widely deployed factory protocol (PLCs, VFDs, power meters,
Factory I/O's "Modbus TCP/IP Server" driver). This connector reads a small block of
holding registers per station and maps them to our normalized Telemetry, exactly
like the OPC-UA and MTConnect connectors — same schema, same topics, same MQTT bus.

Develop against, no factory required:
  - Factory I/O (Modbus TCP/IP Server) — a 3D process sim exposing real Modbus.
  - a pymodbus example server (`python -m pymodbus.server`) or any soft-PLC.

Register map via MODBUS_REGISTER_MAP (JSON) — one entry per station, giving the
holding-register addresses to read:
  MODBUS_REGISTER_MAP='{"S1":{"unit":1,"state":0,"part_count":1,"current_x100":2}}'
Fields: state (int → MachineState via STATE_VALUE_MAP), part_count (int),
current_x100 (amps ×100, int), spindle_rpm (int). Absent fields are skipped.

`pymodbus` is imported lazily so the dependency is only needed when this source is used.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

from services.common import MachineState, SourceType
from services.connectors.base import MqttConnector

log = logging.getLogger("connector.modbus")

# Integer register value -> our lowercase MachineState (same convention as OPC-UA).
STATE_VALUE_MAP = {
    0: MachineState.idle,
    1: MachineState.running,
    2: MachineState.down,
    3: MachineState.maintenance,
    4: MachineState.blocked,
    5: MachineState.starved,
}


def _default_register_map() -> dict:
    raw = os.getenv("MODBUS_REGISTER_MAP", "").strip()
    if not raw:
        return {}
    try:
        return dict(json.loads(raw))
    except Exception as exc:  # noqa: BLE001
        log.error("bad MODBUS_REGISTER_MAP (%s): %s", exc, raw)
        return {}


class ModbusConnector(MqttConnector):
    source = SourceType.real_modbus

    def __init__(self, host: str, port: int = 502, line_id: str = "L1",
                 register_map: Optional[dict] = None, poll_seconds: float = 1.0):
        super().__init__(line_id=line_id, client_id="connector-modbus")
        self.host = host
        self.port = port
        self.register_map = register_map or _default_register_map()
        self.poll_seconds = poll_seconds

    # Pure mapping — register values -> kwargs for publish_station. Unit-testable
    # without a live PLC (the network read is the only part that needs a server).
    @staticmethod
    def registers_to_fields(spec: dict, regs: dict) -> Optional[dict]:
        """`spec` is the station's map entry; `regs` is {address: value}. Returns
        publish_station kwargs, or None if there is no usable state."""
        kw: dict = {}
        if "state" in spec and spec["state"] in regs:
            st = STATE_VALUE_MAP.get(int(regs[spec["state"]]))
            if st is None:
                return None
            kw["state"] = st
        if "part_count" in spec and spec["part_count"] in regs:
            kw["part_count"] = int(regs[spec["part_count"]])
        if "current_x100" in spec and spec["current_x100"] in regs:
            kw["current_a"] = int(regs[spec["current_x100"]]) / 100.0
        if "spindle_rpm" in spec and spec["spindle_rpm"] in regs:
            kw["spindle_rpm"] = float(regs[spec["spindle_rpm"]])
        return kw or None

    async def run(self) -> None:
        from pymodbus.client import AsyncModbusTcpClient  # lazy import

        if not self.register_map:
            log.warning("MODBUS_REGISTER_MAP is empty — connecting but publishing nothing.")
        client = AsyncModbusTcpClient(self.host, port=self.port)
        await client.connect()
        log.info("connected to modbus://%s:%s", self.host, self.port)
        try:
            while not self._stop.is_set():
                for station_id, spec in self.register_map.items():
                    try:
                        await self._poll_station(client, station_id, spec)
                    except Exception as exc:  # noqa: BLE001 - keep polling other stations
                        log.warning("modbus read failed for %s: %s", station_id, exc)
                await self._sleep_or_stop(self.poll_seconds)
        finally:
            client.close()

    async def _poll_station(self, client, station_id: str, spec: dict) -> None:
        addrs = [spec[k] for k in ("state", "part_count", "current_x100", "spindle_rpm") if k in spec]
        if not addrs:
            return
        lo, hi = min(addrs), max(addrs)
        unit = int(spec.get("unit", 1))
        rr = await client.read_holding_registers(lo, count=hi - lo + 1, slave=unit)
        if rr.isError():
            log.warning("modbus error for %s: %s", station_id, rr)
            return
        regs = {lo + i: v for i, v in enumerate(rr.registers)}
        kw = self.registers_to_fields(spec, regs)
        if kw:
            self.publish_station(station_id, **kw)
