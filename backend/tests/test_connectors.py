"""Data-connector layer tests (build plan Part 6).

Covers the three things the connector integration adds:
  1. the `source` provenance field on Telemetry (real vs simulated labeling),
  2. DATA_SOURCE selection (build_connector: passive vs OPC-UA/MTConnect),
  3. the connectors normalizing a real protocol into our Telemetry + MQTT topic.

Everything here is offline — no broker, no network. The MQTT client is stubbed so
we assert on exactly what would be published.
"""

import json

import pytest

from services.common import MachineState, SourceType, Telemetry, telemetry_topic
from services.connectors.mtconnect_connector import MtConnectConnector
from services.connectors.opcua_connector import OpcUaConnector, _SubHandler
from services.connectors.runner import build_connector
from backend.app.ws.live import LiveHub


class _StubClient:
    """Stand-in for paho: records what publish_station() would put on the bus."""

    def __init__(self):
        self.msgs = []

    def publish(self, topic, payload, qos=0, retain=False):
        self.msgs.append((topic, json.loads(payload)))


# -- 1. source field ------------------------------------------------------- #
def test_telemetry_source_defaults_to_simulated():
    t = Telemetry(line_id="L1", station_id="S1", current_a=1.0, part_present=False,
                  part_count=0, state=MachineState.idle)
    assert json.loads(t.model_dump_json())["source"] == "simulated"


def test_telemetry_source_explicit_real():
    t = Telemetry(line_id="L1", station_id="S1", current_a=1.0, part_present=False,
                  part_count=0, state=MachineState.idle, source=SourceType.real_opcua)
    assert json.loads(t.model_dump_json())["source"] == "real_opcua"


# -- 2. DATA_SOURCE selection ---------------------------------------------- #
@pytest.mark.parametrize("src", ["emulator", "simulated", "external", "mqtt", "none", ""])
def test_passive_sources_launch_no_connector(src):
    assert build_connector(src) is None


def test_connector_sources_build():
    assert isinstance(build_connector("mtconnect"), MtConnectConnector)
    assert isinstance(build_connector("opcua"), OpcUaConnector)
    from services.connectors.modbus_connector import ModbusConnector
    assert isinstance(build_connector("modbus"), ModbusConnector)


def test_unknown_source_rejected():
    with pytest.raises(ValueError):
        build_connector("nonsense")


def test_connectors_use_correct_line_and_source():
    op = build_connector("opcua", line_id="L1")
    assert op.line_id == "L1" and op.source is SourceType.real_opcua


# -- 3a. MTConnect parsing ------------------------------------------------- #
MTCONNECT_XML = """<?xml version="1.0"?>
<MTConnectStreams xmlns="urn:mtconnect.org:MTConnectStreams:2.0">
 <Streams>
  <DeviceStream name="Mill-01">
   <ComponentStream><Events>
     <Execution>ACTIVE</Execution><PartCount>42</PartCount>
   </Events></ComponentStream>
  </DeviceStream>
  <DeviceStream name="Lathe-09">
   <ComponentStream><Events><Execution>UNAVAILABLE</Execution></Events></ComponentStream>
  </DeviceStream>
  <DeviceStream name="Unmapped-99">
   <ComponentStream><Events><Execution>ACTIVE</Execution></Events></ComponentStream>
  </DeviceStream>
 </Streams>
</MTConnectStreams>"""


def test_mtconnect_maps_devices_and_skips_unavailable():
    mt = MtConnectConnector("https://demo", device_to_station={"Mill-01": "S2", "Lathe-09": "S3"})
    mt._mqtt = _StubClient()
    mt._handle_current(MTCONNECT_XML)
    # UNAVAILABLE (Lathe-09) and the unmapped device are both skipped.
    assert len(mt._mqtt.msgs) == 1
    topic, msg = mt._mqtt.msgs[0]
    assert topic == telemetry_topic("L1", "S2")
    assert msg["state"] == "running"          # ACTIVE -> running
    assert msg["part_count"] == 42
    assert msg["source"] == "real_mtconnect"


# -- 3b. OPC-UA data-change handling --------------------------------------- #
class _NodeId:
    def __init__(self, s): self._s = s
    def to_string(self): return self._s


class _Node:
    def __init__(self, s): self.nodeid = _NodeId(s)


def test_opcua_maps_state_value_and_merges_fields():
    op = OpcUaConnector("opc.tcp://x", node_map={
        "ns=2;i=1": ("S1", "state"),
        "ns=2;i=2": ("S1", "cycle_time_s"),
    })
    op._mqtt = _StubClient()
    h = _SubHandler(op)
    h.datachange_notification(_Node("ns=2;i=1"), 1, None)     # 1 -> running
    h.datachange_notification(_Node("ns=2;i=2"), 12.5, None)  # merges, keeps running
    topic, msg = op._mqtt.msgs[-1]
    assert topic == telemetry_topic("L1", "S1")
    assert msg["state"] == "running" and msg["cycle_time_s"] == 12.5
    assert msg["source"] == "real_opcua"


def test_opcua_unmapped_state_value_is_dropped():
    op = OpcUaConnector("opc.tcp://x", node_map={"ns=2;i=1": ("S1", "state")})
    op._mqtt = _StubClient()
    _SubHandler(op).datachange_notification(_Node("ns=2;i=1"), 99, None)  # not in STATE_VALUE_MAP
    assert op._mqtt.msgs == []


# -- Modbus register mapping ----------------------------------------------- #
def test_modbus_registers_to_fields():
    from services.connectors.modbus_connector import ModbusConnector
    spec = {"unit": 1, "state": 0, "part_count": 1, "current_x100": 2, "spindle_rpm": 3}
    regs = {0: 1, 1: 42, 2: 450, 3: 1200}   # state=running, 42 parts, 4.5A, 1200rpm
    kw = ModbusConnector.registers_to_fields(spec, regs)
    assert kw["state"] is MachineState.running
    assert kw["part_count"] == 42
    assert kw["current_a"] == 4.5
    assert kw["spindle_rpm"] == 1200.0


def test_modbus_unmapped_state_dropped():
    from services.connectors.modbus_connector import ModbusConnector
    # state register value 99 is not in STATE_VALUE_MAP -> no publish
    assert ModbusConnector.registers_to_fields({"state": 0}, {0: 99}) is None


# -- LiveHub line-level provenance badge ----------------------------------- #
def test_line_source_badge_collapse():
    f = LiveHub._line_source
    assert f([{"online": True, "source": "simulated"}]) == "simulated"
    assert f([{"online": True, "source": "real_opcua"}]) == "real_opcua"
    assert f([{"online": True, "source": "real_opcua"},
              {"online": True, "source": "simulated"}]) == "mixed"
    # an offline station doesn't vote
    assert f([{"online": False, "source": "real_opcua"},
              {"online": True, "source": "simulated"}]) == "simulated"
    assert f([]) == "simulated"
