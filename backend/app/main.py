"""FastAPI backend — Phase 3 (KPI/OEE/throughput/timeline).

Endpoints (build plan §6.3):
    GET /api/stations
    GET /api/kpi/oee?station=S3&window=8h
    GET /api/kpi/throughput?line=L1&window=1h
    GET /api/timeline/{station}?window=8h
    GET /api/health

Reads through the historian interface, so it runs on the SQLite dev store now
and on InfluxDB once Docker is up — no change. Phases 4/5 add /api/simulate/*,
Phase 6 adds /ws/live.

Run:
    ./.venv/bin/uvicorn backend.app.main:app --reload --port 8000
"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import asyncio
from typing import List, Optional

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.common.historian import get_historian  # noqa: E402
from backend.app.kpi.engine import KPIEngine  # noqa: E402


# --------------------------------------------------------------------------- #
# Short-TTL response cache for the read-only aggregate endpoints.
#
# The dashboard polls per-station timelines plus line-level health / bottleneck /
# losses every few seconds, and every browser fires the same requests. Those
# results are identical across clients and cost real work — health recomputes OEE
# for every station, bottleneck runs a SimPy simulation — all against one shared
# SQLite connection. Without a cache a single poll tick becomes a burst of ~20
# concurrent reads that serialise on the DB and collapse (health was measured at
# 47s under load). A per-key lock collapses that burst into ONE compute per key
# per TTL window; same-key callers wait for it, different keys never block.
# --------------------------------------------------------------------------- #
_cache: dict = {}
_cache_locks: dict = {}
_cache_meta_lock = threading.Lock()


def _cached(key: tuple, ttl: float, compute):
    now = time.time()
    with _cache_meta_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
        klock = _cache_locks.setdefault(key, threading.Lock())
    with klock:  # only same-key callers serialise here
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        val = compute()
        _cache[key] = (time.time(), val)
        return val


def create_app(engine: KPIEngine | None = None) -> FastAPI:
    if engine is None:
        engine = KPIEngine(get_historian())

    app = FastAPI(
        title="Real-Time Factory Digital Twin API",
        version="0.8.0",
        description=(
            "Live KPIs, a self-calibrating SimPy digital twin, what-if simulation, "
            "and retrofit state inference for one manufacturing cell.\n\n"
            "- **Monitor**: `/api/stations`, `/api/kpi/*`, `/api/timeline/*`, `/ws/live`\n"
            "- **Simulate**: `/api/simulate/validate`, `/api/simulate/whatif`, `/api/analyze/bottleneck`\n"
            "- **Self-calibration**: `/api/calibrate`, `/api/calibrations`\n\n"
            "Reads through a historian interface (SQLite dev / InfluxDB). "
            "Interactive docs: **/docs** (Swagger) · **/redoc** (ReDoc)."
        ),
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )
    app.state.engine = engine

    from backend.app.ws.live import LiveHub
    hub = LiveHub(engine)
    app.state.hub = hub

    @app.on_event("startup")
    async def _startup():
        hub.start(asyncio.get_event_loop())
        # DATA_SOURCE selects the primary live source (build plan Part 6); EXTRA_SOURCES
        # is a JSON list of additional real endpoints so the twin can pull from several
        # public manufacturing feeds at once. Every connector publishes the same
        # Telemetry schema to the same MQTT topics, so nothing downstream changes.
        import os, json, logging
        log = logging.getLogger("backend")
        app.state.connectors = []
        app.state.connector_tasks = []

        from services.connectors.runner import build_connector, run_forever

        def _launch(c):
            if c is not None:
                app.state.connectors.append(c)
                app.state.connector_tasks.append(asyncio.create_task(run_forever(c)))

        source = os.getenv("DATA_SOURCE", "emulator")
        try:
            _launch(build_connector(source))
        except Exception as exc:  # noqa: BLE001 - a bad source must not stop the API/UI
            log.error("DATA_SOURCE=%s connector failed to start: %s", source, exc)

        # EXTRA_SOURCES: [{"type":"mtconnect","url":...,"device_map":{...},"poll":2.0}, ...]
        for spec in json.loads(os.getenv("EXTRA_SOURCES", "[]") or "[]"):
            try:
                if spec.get("type") == "mtconnect":
                    from services.connectors.mtconnect_connector import MtConnectConnector
                    _launch(MtConnectConnector(spec["url"], line_id=spec.get("line", "L1"),
                            device_to_station=spec.get("device_map"),
                            poll_seconds=float(spec.get("poll", 2.0))))
                elif spec.get("type") == "opcua":
                    from services.connectors.opcua_connector import OpcUaConnector
                    _launch(OpcUaConnector(spec["url"], line_id=spec.get("line", "L1"),
                            node_map={k: (v[0], v[1]) for k, v in (spec.get("node_map") or {}).items()}))
            except Exception as exc:  # noqa: BLE001
                log.error("EXTRA_SOURCES entry %s failed: %s", spec, exc)

    @app.on_event("shutdown")
    async def _shutdown():
        for c in getattr(app.state, "connectors", []):
            try:
                c.stop()
            except Exception:  # noqa: BLE001
                pass
        for t in getattr(app.state, "connector_tasks", []):
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    @app.websocket("/ws/live")
    async def ws_live(ws: WebSocket):
        await ws.accept()
        if not hub._started:
            hub.start(asyncio.get_event_loop())
        hub.add(ws)
        try:
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            hub.remove(ws)
        except Exception:  # noqa: BLE001
            hub.remove(ws)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "historian": engine.h.backend}

    @app.get("/api/stations")
    def stations():
        return engine.stations()

    @app.get("/api/kpi/oee")
    def kpi_oee(station: str = Query(..., description="station id, e.g. S3"),
                window: str = "8h"):
        return _cached(("oee", station, window), 6.0,
                       lambda: engine.oee(station, window))

    @app.get("/api/kpi/throughput")
    def kpi_throughput(line: str = "L1", window: str = "1h"):
        return _cached(("throughput", line, window), 8.0,
                       lambda: engine.throughput(line, window))

    @app.get("/api/timeline/{station}")
    def timeline(station: str, window: str = "8h"):
        return _cached(("timeline", station, window), 8.0,
                       lambda: engine.timeline(station, window))

    @app.get("/api/simulate/validate")
    def simulate_validate(line: str = "L1", window: str = "8h",
                          replications: int = 8, buffer_capacity: int = 3):
        return engine.validate(line, window, replications, buffer_capacity)

    # -- Phase 5 ---------------------------------------------------------- #
    @app.post("/api/simulate/whatif")
    def simulate_whatif(req: WhatIfRequest):
        return engine.whatif(req.line, req.window, [c.model_dump(exclude_none=True)
                             for c in req.changes], req.replications, req.buffer_capacity)

    @app.get("/api/analyze/bottleneck")
    def analyze_bottleneck(line: str = "L1", window: str = "8h",
                           replications: int = 8, buffer_capacity: int = 3):
        # SimPy simulation (replications runs) — the most expensive endpoint;
        # cache longest so a 6s poll can't re-run the simulation each time.
        return _cached(("bottleneck", line, window, replications, buffer_capacity), 30.0,
                       lambda: engine.bottleneck(line, window, replications, buffer_capacity))

    @app.get("/api/kpi/losses")
    def kpi_losses(line: str = "L1", window: str = "8h"):
        return _cached(("losses", line, window), 20.0,
                       lambda: engine.losses(line, window))

    @app.get("/api/analyze/health")
    def analyze_health(line: str = "L1", window: str = "8h"):
        # Recomputes OEE for every station (~3.7s cold) — cache longer than the
        # dashboard's ~6s poll so most polls hit the cache instead of recomputing.
        return _cached(("health", line, window), 20.0,
                       lambda: engine.health(line, window))

    @app.get("/api/simulate/optimize")
    def simulate_optimize(line: str = "L1", window: str = "8h",
                          replications: int = 5, buffer_capacity: int = 3):
        return engine.optimize(line, window, replications, buffer_capacity)

    @app.post("/api/calibrate")
    def calibrate(line: str = "L1", window: str = "1h", buffer_capacity: int = 3):
        return engine.calibrate(line, window, buffer_capacity)

    @app.get("/api/calibrations")
    def calibrations(line: Optional[str] = None, limit: int = 50):
        return engine.calibrations(line, limit)

    @app.get("/api/assets")
    def assets(line: str = "L1"):
        from services.common.assets import get_assets, line_name, get_layout, line_product
        layout = get_layout(line)
        return {"line_id": line, "line_name": line_name(line), "product": line_product(line),
                "stations": get_assets(line), "flow": layout["flow"], "zones": layout["zones"]}

    @app.get("/api/lines")
    def lines():
        """The selectable lines/plants for the view switcher."""
        from services.common.assets import line_ids, line_name
        out = [{"id": lid, "name": line_name(lid)} for lid in line_ids()]
        out.append({"id": "ALL", "name": "All lines (whole factory)"})
        return out

    @app.get("/api/copilot/status")
    def copilot_status():
        from backend.app.copilot import copilot_available
        return {"available": copilot_available()}

    @app.post("/api/ask")
    def ask(req: AskRequest):
        from backend.app.copilot import ask as copilot_ask
        return copilot_ask(engine, req.question, req.window)

    return app


class AskRequest(BaseModel):
    question: str
    window: str = "1h"


class WhatIfChange(BaseModel):
    type: str = Field(..., description="cycle_reduction | add_operator | set_cycle | buffer_size")
    station: Optional[str] = None
    percent: Optional[float] = None
    operators: Optional[int] = None
    value: Optional[float] = None


class WhatIfRequest(BaseModel):
    line: str = "L1"
    window: str = "8h"
    changes: List[WhatIfChange]
    replications: int = 10
    buffer_capacity: int = 3


app = create_app()
