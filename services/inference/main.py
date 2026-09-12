#!/usr/bin/env python3
"""Inference service — raw (current+IR) -> inferred telemetry (novelty #1, Phase 8).

Subscribes to factory/+/+/raw (published by retrofit ESP32s on legacy machines),
infers machine state + cycle time from current + IR (see inference.py), and
republishes a full Telemetry message to factory/{line}/{station}/telemetry — the
SAME schema the emulator/PLC use, so ingestion, the twin, and the dashboard are
unchanged.

    ./.venv/bin/python services/inference/main.py
"""

from __future__ import annotations

import logging
import signal
import sys
from pathlib import Path

import paho.mqtt.client as mqtt

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.common import (  # noqa: E402
    Event, EventType, RawTelemetry, Telemetry, RAW_WILDCARD, event_topic, telemetry_topic,
)
from services.common.config import get_settings  # noqa: E402
from services.common.historian import ts_to_epoch  # noqa: E402
from services.common.topics import parse_topic  # noqa: E402
from services.inference.inference import StateInferencer  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s inference: %(message)s")
log = logging.getLogger("inference")


class InferenceService:
    def __init__(self):
        self.cfg = get_settings()
        self._inf: dict = {}          # station_id -> StateInferencer
        self._last_cycle: dict = {}   # station_id -> last completed cycle_time_s
        self._last_state: dict = {}   # station_id -> last inferred state (for events)
        self._change_ts: dict = {}    # station_id -> epoch of last state change
        self._n = 0

        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="inference")
        if self.cfg.mqtt_username:
            self._mqtt.username_pw_set(self.cfg.mqtt_username, self.cfg.mqtt_password)
        self._mqtt.reconnect_delay_set(min_delay=1, max_delay=30)
        self._mqtt.on_connect = self._on_connect
        self._mqtt.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.error("MQTT connect failed (rc=%s)", reason_code)
            return
        log.info("connected; subscribing to raw signals")
        client.subscribe(RAW_WILDCARD)

    def _on_message(self, client, userdata, msg):
        parsed = parse_topic(msg.topic)
        if not parsed or parsed[2] != "raw":
            return
        try:
            raw = RawTelemetry.model_validate_json(msg.payload)
        except Exception as exc:  # noqa: BLE001
            log.error("bad raw payload on %s: %s", msg.topic, exc)
            return

        sid = raw.station_id
        inf = self._inf.get(sid)
        if inf is None:
            inf = self._inf[sid] = StateInferencer(sid)
        ts_epoch = ts_to_epoch(raw.ts)
        state, cycle = inf.update(ts_epoch, raw.current_a, raw.part_present, raw.part_count)
        if cycle is not None:
            self._last_cycle[sid] = cycle

        out = Telemetry(ts=raw.ts, line_id=raw.line_id, station_id=sid,
                        current_a=raw.current_a, part_present=raw.part_present,
                        part_count=raw.part_count, cycle_time_s=self._last_cycle.get(sid),
                        state=state)
        client.publish(telemetry_topic(raw.line_id, sid), out.model_dump_json(), qos=0)

        # emit an event on an inferred state change, so downstream KPIs (which
        # reconstruct state durations from events) work exactly as for Route A
        prev = self._last_state.get(sid)
        if prev is None:
            self._last_state[sid] = state
            self._change_ts[sid] = ts_epoch
        elif state != prev:
            dur = ts_epoch - self._change_ts.get(sid, ts_epoch)
            ev = Event(ts=raw.ts, line_id=raw.line_id, station_id=sid,
                       event_type=EventType(state.value), reason="inferred",
                       duration_s=round(dur, 2))
            client.publish(event_topic(raw.line_id, sid), ev.model_dump_json(), qos=0)
            self._last_state[sid] = state
            self._change_ts[sid] = ts_epoch
        self._n += 1
        if self._n % 200 == 0:
            log.info("inferred %d samples; %d stations", self._n, len(self._inf))

    def run(self):
        log.info("MQTT %s:%s  raw -> inferred telemetry", self.cfg.mqtt_host, self.cfg.mqtt_port)
        self._mqtt.connect(self.cfg.mqtt_host, self.cfg.mqtt_port, keepalive=60)
        stop = {"flag": False}
        signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
        signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))
        self._mqtt.loop_start()
        try:
            while not stop["flag"]:
                signal.pause()
        finally:
            self._mqtt.loop_stop()
            self._mqtt.disconnect()
            log.info("stopped. inferred %d samples.", self._n)


if __name__ == "__main__":
    InferenceService().run()
