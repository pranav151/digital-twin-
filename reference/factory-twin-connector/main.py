"""
Wiring for Part 15/17: the frontend connects to ONE WebSocket regardless of
whether the backend is currently running the OPC UA, MTConnect, or simulator
connector. Swap DATA_SOURCE and nothing else changes.

Run: DATA_SOURCE=simulator uvicorn main:app --reload
"""
from __future__ import annotations
import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from schema import TwinEvent
from twin_state import DigitalTwinState
from connectors.simulator_connector import SimulatorConnector
from connectors.mtconnect_connector import MtConnectConnector
from connectors.opcua_connector import OpcUaConnector

app = FastAPI()
twin = DigitalTwinState()
event_queue: "asyncio.Queue[TwinEvent]" = asyncio.Queue()
active_sockets: list[WebSocket] = []


async def _ws_broadcast(payload: dict) -> None:
    dead = []
    for ws in active_sockets:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_sockets.remove(ws)


def _build_connector(source: str):
    if source == "simulator":
        return SimulatorConnector(event_queue, plant_id="PLANT_01", line_id="LINE_01",
                                   params_path="config/station_params.json")
    if source == "mtconnect":
        return MtConnectConnector(event_queue, agent_base_url="https://demo.mtconnect.org",
                                   plant_id="PLANT_01", line_id="LINE_01",
                                   device_to_station={"Mazak01": "S1"})  # adjust to the demo device names
    if source == "opcua":
        return OpcUaConnector(event_queue, endpoint_url="opc.tcp://milo.digitalpetri.com:62541/milo",
                               plant_id="PLANT_01", line_id="LINE_01")
    raise ValueError(f"unknown DATA_SOURCE: {source}")


@app.on_event("startup")
async def startup() -> None:
    twin.add_broadcaster(_ws_broadcast)
    asyncio.create_task(twin.consume(event_queue))
    connector = _build_connector(os.environ.get("DATA_SOURCE", "simulator"))
    asyncio.create_task(connector.run())


@app.websocket("/ws/twin")
async def twin_socket(ws: WebSocket) -> None:
    await ws.accept()
    active_sockets.append(ws)
    try:
        while True:
            await ws.receive_text()  # frontend doesn't need to send anything; keeps the socket open
    except WebSocketDisconnect:
        active_sockets.remove(ws)


@app.get("/api/stations")
async def stations() -> dict:
    return {sid: s.model_dump(mode="json") for sid, s in twin.stations.items()}


@app.get("/api/bottleneck")
async def bottleneck() -> dict:
    return {"bottleneck_station": twin.bottleneck()}
