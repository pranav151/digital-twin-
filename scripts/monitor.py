#!/usr/bin/env python3
"""Subscribe to the factory MQTT bus and pretty-print — a broker-side sanity check.

Use this to satisfy the Phase 0/1 DoD without installing MQTT Explorer:

    # terminal 1: broker up (docker compose up -d)
    # terminal 2:
    python scripts/monitor.py
    # terminal 3:
    python edge/emulator/emulator.py --scenario bottleneck

You should see live telemetry + events scroll past.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import paho.mqtt.client as mqtt

TELEMETRY_WILDCARD = "factory/+/+/telemetry"
EVENT_WILDCARD = "factory/+/+/event"

_TAG = {"running": "RUN", "idle": "IDL", "blocked": "BLK", "down": "DWN"}


def on_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[monitor] connected (rc={reason_code}); subscribing…", file=sys.stderr)
    client.subscribe([(TELEMETRY_WILDCARD, 0), (EVENT_WILDCARD, 0)])


def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
    except Exception:  # noqa: BLE001
        print(f"{msg.topic}  <non-json {len(msg.payload)}B>")
        return

    if msg.topic.endswith("/event"):
        print(
            f"EVENT  {payload.get('station_id')}  -> {payload.get('event_type'):8s}"
            f"  reason={payload.get('reason')}  prev={payload.get('duration_s')}s"
        )
    else:
        st = payload.get("state", "?")
        print(
            f"TELE   {payload.get('station_id')}  {_TAG.get(st, st):3s}"
            f"  I={payload.get('current_a'):>6}A  count={payload.get('part_count'):>4}"
            f"  cyc={payload.get('cycle_time_s')}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Print factory MQTT traffic.")
    ap.add_argument("--broker", default=os.getenv("MQTT_HOST", "localhost"))
    ap.add_argument("--port", type=int, default=int(os.getenv("MQTT_PORT", "1883")))
    args = ap.parse_args()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="monitor")
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(args.broker, args.port, keepalive=60)
    print(f"[monitor] listening on mqtt://{args.broker}:{args.port} (Ctrl-C to stop)",
          file=sys.stderr)
    try:
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[monitor] bye", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
