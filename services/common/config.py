"""Central config, read from environment (.env). See .env.example.

Kept dependency-free (stdlib only) so the emulator and every service can import
it without pulling extra packages.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # --- MQTT broker (Mosquitto) ---
    mqtt_host: str
    mqtt_port: int
    mqtt_username: str
    mqtt_password: str

    # --- InfluxDB (Phase 2+) ---
    influx_url: str
    influx_token: str
    influx_org: str
    influx_bucket: str


def get_settings() -> Settings:
    return Settings(
        mqtt_host=os.getenv("MQTT_HOST", "localhost"),
        mqtt_port=int(os.getenv("MQTT_PORT", "1883")),
        mqtt_username=os.getenv("MQTT_USERNAME", ""),
        mqtt_password=os.getenv("MQTT_PASSWORD", ""),
        influx_url=os.getenv("INFLUX_URL", "http://localhost:8086"),
        influx_token=os.getenv("INFLUX_TOKEN", ""),
        influx_org=os.getenv("INFLUX_ORG", "factory"),
        influx_bucket=os.getenv("INFLUX_BUCKET", "telemetry"),
    )
