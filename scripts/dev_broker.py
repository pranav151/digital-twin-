#!/usr/bin/env python3
"""Headless MQTT broker for local dev — a zero-install stand-in for Mosquitto.

Uses amqtt (pure Python) so the whole stack runs without Docker. Same MQTT wire
protocol as Mosquitto, so the emulator / ingestion / monitor don't know the
difference. When you bring up the real broker via docker-compose, just stop this.

    ./.venv/bin/python scripts/dev_broker.py            # listens on 0.0.0.0:1883
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os

from amqtt.broker import Broker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s broker: %(message)s")
log = logging.getLogger("dev_broker")


async def _run(bind: str):
    config = {
        "listeners": {
            "default": {"type": "tcp", "bind": bind, "max_connections": 200},
        },
        "sys_interval": 0,
        "auth": {"allow-anonymous": True},
        "topic_check": {"enabled": False},
    }
    broker = Broker(config)
    await broker.start()
    log.info("MQTT broker listening on %s (anonymous). Ctrl-C to stop.", bind)
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        pass
    finally:
        await broker.shutdown()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bind", default=f"0.0.0.0:{os.getenv('MQTT_PORT', '1883')}")
    args = ap.parse_args()
    try:
        asyncio.run(_run(args.bind))
    except KeyboardInterrupt:
        log.info("bye")


if __name__ == "__main__":
    main()
