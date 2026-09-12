"""Base class for a data connector that publishes to our MQTT bus.

The reference connector layer pushed a normalized `TwinEvent` onto an in-process
`asyncio.Queue`; our transport is MQTT, so every connector here instead publishes
`services.common.Telemetry` to `factory/{line}/{station}/telemetry` — byte-for-byte
the contract the emulator and the real ESP32 firmware already speak. The only new
thing on the wire is the `source` field (real_opcua / real_mtconnect vs simulated).

A real source often updates one tag at a time (an OPC-UA data-change fires for
`state` alone). `publish_station()` therefore merges partial fields into the
station's last-known snapshot and always emits a *complete* Telemetry, so
downstream consumers never see a half-populated message.
"""

from __future__ import annotations

import abc
import asyncio
import logging
import os
import uuid
from typing import Optional

import paho.mqtt.client as mqtt

from services.common import (
    MachineState,
    SourceType,
    Telemetry,
    telemetry_topic,
    utcnow_iso,
)
from services.common.config import get_settings

log = logging.getLogger("connector")


class MqttConnector(abc.ABC):
    """Abstract connector: subclasses implement `run()`; the base handles MQTT."""

    # Subclasses override this so every sample is labeled with its provenance.
    source: SourceType = SourceType.simulated

    def __init__(self, line_id: str = "L1", client_id: str = "connector"):
        self.line_id = line_id
        self.cfg = get_settings()
        self._client_id = client_id
        self._mqtt: Optional[mqtt.Client] = None
        self._stop = asyncio.Event()
        # last full state per station, so a one-field update still publishes a
        # complete Telemetry snapshot.
        self._latest: dict[str, dict] = {}

    # -- mqtt lifecycle ---------------------------------------------------- #
    def connect(self) -> None:
        # Unique client id per instance — two connectors of the same kind (e.g. two
        # MTConnect agents) must NOT share a client id or the broker kicks one off.
        cid = f"{self._client_id}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cid)
        if self.cfg.mqtt_username:
            c.username_pw_set(self.cfg.mqtt_username, self.cfg.mqtt_password)
        c.reconnect_delay_set(min_delay=1, max_delay=30)
        c.connect(self.cfg.mqtt_host, self.cfg.mqtt_port, keepalive=60)
        c.loop_start()
        self._mqtt = c
        log.info(
            "%s -> mqtt://%s:%s (line=%s, source=%s)",
            self._client_id, self.cfg.mqtt_host, self.cfg.mqtt_port,
            self.line_id, self.source.value,
        )

    def close(self) -> None:
        if self._mqtt is not None:
            self._mqtt.loop_stop()
            self._mqtt.disconnect()
            self._mqtt = None

    # -- publish ----------------------------------------------------------- #
    def publish_station(
        self,
        station_id: str,
        *,
        state: Optional[MachineState] = None,
        current_a: Optional[float] = None,
        part_present: Optional[bool] = None,
        part_count: Optional[int] = None,
        cycle_time_s: Optional[float] = None,
        spindle_rpm: Optional[float] = None,
        ts: Optional[str] = None,
    ) -> None:
        """Merge the given fields into the station's snapshot and publish Telemetry."""
        cur = self._latest.setdefault(
            station_id,
            {"current_a": 0.0, "part_present": False, "part_count": 0,
             "cycle_time_s": None, "state": MachineState.idle, "spindle_rpm": None},
        )
        if state is not None:
            cur["state"] = state
        if current_a is not None:
            cur["current_a"] = current_a
        if part_present is not None:
            cur["part_present"] = part_present
        if part_count is not None:
            cur["part_count"] = part_count
        if cycle_time_s is not None:
            cur["cycle_time_s"] = cycle_time_s
        if spindle_rpm is not None:
            cur["spindle_rpm"] = spindle_rpm

        if self._mqtt is None:
            raise RuntimeError("call connect() before publishing")

        msg = Telemetry(
            ts=ts or utcnow_iso(),
            line_id=self.line_id,
            station_id=station_id,
            current_a=float(cur["current_a"]),
            part_present=bool(cur["part_present"]),
            part_count=int(cur["part_count"]),
            cycle_time_s=cur["cycle_time_s"],
            state=cur["state"],
            source=self.source,
            spindle_rpm=cur["spindle_rpm"],
        )
        self._mqtt.publish(
            telemetry_topic(self.line_id, station_id),
            msg.model_dump_json(), qos=0, retain=False,
        )

    # -- run --------------------------------------------------------------- #
    @abc.abstractmethod
    async def run(self) -> None:
        """Connect to the source and publish until stop() is called."""

    def stop(self) -> None:
        self._stop.set()

    async def _sleep_or_stop(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)
        except (asyncio.TimeoutError, TimeoutError):
            pass
