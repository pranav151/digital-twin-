#!/usr/bin/env python3
"""Ingestion service — MQTT -> historian (build plan Phase 2).

Subscribes to the factory bus, validates every payload against the shared
schemas, and writes it to the historian (plan §6.2). The historian backend is
chosen by HISTORIAN_BACKEND (auto|sqlite|influx): SQLite for local dev now,
InfluxDB once it's reachable — no code change either way.

Robust to broker restarts (paho auto-reconnect) and to bad payloads (logged,
dropped, keep going).

    ./.venv/bin/python services/ingestion/main.py
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.common import Event, Telemetry, TELEMETRY_WILDCARD, EVENT_WILDCARD  # noqa: E402
from services.common.config import get_settings  # noqa: E402
from services.common.historian import get_historian  # noqa: E402
from services.common.topics import parse_topic  # noqa: E402

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s ingestion: %(message)s"
)
log = logging.getLogger("ingestion")


class Ingestor:
    def __init__(self):
        self.cfg = get_settings()
        self.hist = get_historian()
        self._n_tele = self._n_evt = self._n_err = 0
        # Retention: keep only the recent working set so windowed KPI queries stay
        # fast (the historian otherwise grows unbounded at the live emit rate).
        self._retention_s = float(os.getenv("HISTORIAN_RETENTION_S", "2700"))  # 45 min
        self._prune_every_s = float(os.getenv("HISTORIAN_PRUNE_EVERY_S", "120"))
        self._last_prune = 0.0

        self._mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ingestion")
        if self.cfg.mqtt_username:
            self._mqtt.username_pw_set(self.cfg.mqtt_username, self.cfg.mqtt_password)
        self._mqtt.reconnect_delay_set(min_delay=1, max_delay=30)
        self._mqtt.on_connect = self._on_connect
        self._mqtt.on_disconnect = self._on_disconnect
        self._mqtt.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.error("MQTT connect failed (rc=%s)", reason_code)
            return
        log.info("connected to broker; subscribing")
        client.subscribe([(TELEMETRY_WILDCARD, 0), (EVENT_WILDCARD, 0)])

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        log.warning("MQTT disconnected (rc=%s); paho will auto-reconnect", reason_code)

    def _on_message(self, client, userdata, msg):
        parsed = parse_topic(msg.topic)
        if not parsed:
            return
        _, _, kind = parsed
        try:
            if kind == "telemetry":
                self.hist.write_telemetry(Telemetry.model_validate_json(msg.payload))
                self._n_tele += 1
                if self._n_tele % 100 == 0:
                    log.info("wrote telemetry=%d events=%d errors=%d",
                             self._n_tele, self._n_evt, self._n_err)
                self._maybe_prune()
            else:
                self.hist.write_event(Event.model_validate_json(msg.payload))
                self._n_evt += 1
        except Exception as exc:  # noqa: BLE001
            self._n_err += 1
            log.error("bad message on %s: %s", msg.topic, exc)

    def _maybe_prune(self):
        if self._retention_s <= 0:
            return
        now = time.time()
        if now - self._last_prune < self._prune_every_s:
            return
        self._last_prune = now
        try:
            deleted = self.hist.prune(self._retention_s)
            if deleted:
                log.info("pruned %d rows older than %.0fs (retention)",
                         deleted, self._retention_s)
        except Exception as exc:  # noqa: BLE001
            log.error("prune failed: %s", exc)

    def run(self):
        log.info("historian backend: %s", self.hist.backend)
        log.info("MQTT %s:%s -> historian", self.cfg.mqtt_host, self.cfg.mqtt_port)
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
            self.hist.close()
            log.info("stopped. telemetry=%d events=%d errors=%d",
                     self._n_tele, self._n_evt, self._n_err)


if __name__ == "__main__":
    Ingestor().run()
