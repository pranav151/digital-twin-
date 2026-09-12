"""
The Data Connector abstraction from your Part 15 diagram.

DATA SOURCES (OPC UA / MTConnect / REST / simulator)
        -> DataConnector.run() pushes normalized TwinEvents onto one asyncio.Queue
        -> DigitalTwinState consumes the queue
        -> WebSocket broadcasts to the frontend

The state engine and frontend never import asyncua or httpx directly — only
this interface. Swapping real for simulated is swapping which connector you
instantiate in main.py, nothing downstream changes.
"""
from __future__ import annotations
import abc
import asyncio
from schema import TwinEvent


class DataConnector(abc.ABC):
    """Base class for every source adapter (OPC UA, MTConnect, simulator, ...)."""

    def __init__(self, out_queue: "asyncio.Queue[TwinEvent]"):
        self.out_queue = out_queue
        self._stop = asyncio.Event()

    async def emit(self, event: TwinEvent) -> None:
        await self.out_queue.put(event)

    @abc.abstractmethod
    async def run(self) -> None:
        """Connect, subscribe/poll, and call self.emit(...) for every observation.
        Must exit cleanly when self._stop is set."""
        raise NotImplementedError

    def stop(self) -> None:
        self._stop.set()
