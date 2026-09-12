"""Run a connector standalone (an alternative to the backend launching it):

    python -m services.connectors --source opcua
    python -m services.connectors --source mtconnect -v

It publishes normalized Telemetry to the MQTT bus exactly like the emulator, but
sourced from a real/demo OPC-UA or MTConnect endpoint. Handy for developing a
connector against a public demo while the backend runs against the emulator.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os

from services.connectors.runner import build_connector, run_forever


def main() -> None:
    ap = argparse.ArgumentParser(description="Factory Twin data connector")
    ap.add_argument("--source", default=os.getenv("DATA_SOURCE", "opcua"),
                    help="opcua | mtconnect")
    ap.add_argument("--line", default=os.getenv("CONNECTOR_LINE_ID", "L1"))
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    connector = build_connector(args.source, line_id=args.line)
    if connector is None:
        raise SystemExit(
            f"--source {args.source!r} is passive (publishes to MQTT on its own); "
            f"run the emulator instead, or pick opcua|mtconnect."
        )
    try:
        asyncio.run(run_forever(connector))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
