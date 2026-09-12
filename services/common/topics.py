"""MQTT topic strings — the shared bus contract (build plan Section 6.1).

Topic shape:
    factory/{line_id}/{station_id}/telemetry
    factory/{line_id}/{station_id}/event

Keep this as the single source of truth. The emulator (Phase 1) and the real
ESP32 firmware (Phase 8) publish to the *same* topics, so nothing downstream
changes when hardware is swapped in.
"""

TELEMETRY_TEMPLATE = "factory/{line_id}/{station_id}/telemetry"
EVENT_TEMPLATE = "factory/{line_id}/{station_id}/event"
# Route B (legacy machine): the ESP32 publishes RAW signals (current + IR) here;
# services/inference converts them to state and republishes to .../telemetry.
RAW_TEMPLATE = "factory/{line_id}/{station_id}/raw"
# Per-part traceability (line-level): a finished part leaving the line.
PART_TEMPLATE = "factory/{line_id}/part"

# Wildcard subscriptions.
TELEMETRY_WILDCARD = "factory/+/+/telemetry"
EVENT_WILDCARD = "factory/+/+/event"
RAW_WILDCARD = "factory/+/+/raw"
PART_WILDCARD = "factory/+/part"


def telemetry_topic(line_id: str, station_id: str) -> str:
    return TELEMETRY_TEMPLATE.format(line_id=line_id, station_id=station_id)


def event_topic(line_id: str, station_id: str) -> str:
    return EVENT_TEMPLATE.format(line_id=line_id, station_id=station_id)


def raw_topic(line_id: str, station_id: str) -> str:
    return RAW_TEMPLATE.format(line_id=line_id, station_id=station_id)


def part_topic(line_id: str) -> str:
    return PART_TEMPLATE.format(line_id=line_id)


def parse_topic(topic: str):
    """Return (line_id, station_id, kind) for a factory topic, else None.

    kind is 'telemetry', 'event', or 'raw'. Line-level 'part' topics
    (factory/{line}/part) return (line, None, 'part').
    """
    parts = topic.split("/")
    if len(parts) == 4 and parts[0] == "factory" and parts[3] in ("telemetry", "event", "raw"):
        return parts[1], parts[2], parts[3]
    if len(parts) == 3 and parts[0] == "factory" and parts[2] == "part":
        return parts[1], None, "part"
    return None
