"""Live WebSocket hub — pushes telemetry + KPI deltas to the UI (plan §6.3, §8).

Subscribes to the MQTT bus for instantaneous per-station state (so the dashboard
and floor view update in real time) and refreshes KPIs from the historian on a
slower cadence. Broadcasts a snapshot to all `/ws/live` clients ~1 Hz.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from collections import deque
from typing import Optional

import paho.mqtt.client as mqtt

from services.common import TELEMETRY_WILDCARD, EVENT_WILDCARD, PART_WILDCARD
from services.common.config import get_settings
from services.common.topics import parse_topic


class LiveHub:
    def __init__(self, engine, kpi_window: str = "15m", kpi_every_s: float = 9.0):
        self.engine = engine
        self.cfg = get_settings()
        self.kpi_window = kpi_window
        self.kpi_every_s = kpi_every_s

        self._lock = threading.Lock()
        self._latest: dict = {}          # station_id -> live telemetry dict
        self._last_seen: dict = {}       # station_id -> wall-clock time of last message
        self.offline_after_s = float(os.getenv("OFFLINE_AFTER_S", "8"))
        self._issues: deque = deque(maxlen=15)
        self._parts: deque = deque(maxlen=12)   # recent finished parts (traceability)
        self._clients: set = set()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._mqtt: Optional[mqtt.Client] = None
        self._kpi: dict = {}
        self._kpi_at = 0.0
        self._started = False

    # -- lifecycle --------------------------------------------------------- #
    def start(self, loop: asyncio.AbstractEventLoop) -> bool:
        if self._started:
            return True
        self._loop = loop
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="live-hub")
        if self.cfg.mqtt_username:
            c.username_pw_set(self.cfg.mqtt_username, self.cfg.mqtt_password)
        c.reconnect_delay_set(min_delay=1, max_delay=30)
        c.on_connect = self._on_connect
        c.on_message = self._on_message
        try:
            c.connect(self.cfg.mqtt_host, self.cfg.mqtt_port, keepalive=60)
        except Exception:  # noqa: BLE001 - broker may be down; hub still serves cached KPI
            return False
        c.loop_start()
        self._mqtt = c
        self._started = True
        loop.create_task(self._broadcast_loop())
        return True

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        client.subscribe([(TELEMETRY_WILDCARD, 0), (EVENT_WILDCARD, 0), (PART_WILDCARD, 0)])

    def _on_message(self, client, userdata, msg):
        parsed = parse_topic(msg.topic)
        if not parsed:
            return
        _, _, kind = parsed
        try:
            payload = json.loads(msg.payload)
        except Exception:  # noqa: BLE001
            return
        with self._lock:
            if kind == "telemetry":
                self._latest[payload["station_id"]] = payload
                self._last_seen[payload["station_id"]] = time.time()
            elif kind == "part":
                self._parts.appendleft({
                    "part_id": payload.get("part_id"), "ts": payload.get("ts"),
                    "lead_time_s": payload.get("lead_time_s"),
                })
            elif kind == "event" and payload.get("event_type") in ("down", "blocked", "maintenance"):
                self._issues.appendleft({
                    "ts": payload.get("ts"), "station_id": payload.get("station_id"),
                    "event_type": payload.get("event_type"), "reason": payload.get("reason"),
                })

    # -- websocket registration ------------------------------------------- #
    def add(self, ws):
        self._clients.add(ws)

    def remove(self, ws):
        self._clients.discard(ws)

    # -- snapshot + broadcast --------------------------------------------- #
    def _refresh_kpi(self):
        now = time.time()
        if now - self._kpi_at < self.kpi_every_s and self._kpi:
            return
        self._kpi_at = now
        try:
            stations = {}
            for s in self.engine.stations():
                sid = s["station_id"]
                o = self.engine.oee(sid, self.kpi_window)
                stations[sid] = {
                    "oee": round(o.get("oee", 0.0), 3),
                    "availability": round(o.get("availability", 0.0), 3),
                    "performance": round(o.get("performance", 0.0), 3),
                    "quality": round(o.get("quality", 0.0), 3),
                    "utilization": round(o.get("utilization", 0.0), 3),
                }
            # Plant-wide throughput: sum every configured line's terminal output
            # so the headline reflects the whole plant (L1 + L2 + …), not one line.
            try:
                from services.common.assets import line_ids
                lids = line_ids() or ["L1"]
            except Exception:  # noqa: BLE001
                lids = ["L1"]
            uph = 0.0
            producing = []
            for lid in lids:
                t = self.engine.throughput(lid, self.kpi_window)
                uph += t.get("units_per_hr", 0.0) or 0.0
                if t.get("terminal_station"):
                    producing.append(lid)
            self._kpi = {
                "stations": stations,
                "line": {"units_per_hr": round(uph, 1),
                         "terminal_station": "+".join(producing) if producing else None},
            }
        except Exception:  # noqa: BLE001
            pass

    def _snapshot(self) -> dict:
        # NB: KPI refresh runs in a thread executor (see _broadcast_loop), never
        # here — this method stays cheap so it can't stall the event loop.
        now = time.time()
        try:
            from services.common.assets import station_line_map
            line_of = station_line_map()          # lru-cached; cheap per tick
        except Exception:  # noqa: BLE001
            line_of = {}
        with self._lock:
            stations = []
            for sid, p in sorted(self._latest.items()):
                stale = (now - self._last_seen.get(sid, 0)) > self.offline_after_s
                stations.append({
                    "station_id": sid,
                    # which plant/line this station belongs to (from assets.yaml),
                    # so the UI can scope the floor + rail to the selected line.
                    "line_id": line_of.get(sid),
                    # D1: a station with no telemetry for offline_after_s reads OFFLINE,
                    # regardless of its last reported state.
                    "state": "offline" if stale else p.get("state"),
                    "online": not stale,
                    "current_a": p.get("current_a"),
                    "part_count": p.get("part_count"),
                    "cycle_time_s": p.get("cycle_time_s"),
                    "part_present": p.get("part_present"),
                    # provenance carried straight through from the payload (defaults
                    # to "simulated"); lets the UI badge real hardware vs the emulator.
                    "source": p.get("source", "simulated"),
                    # optional real machine signal (MTConnect spindle RPM); None for sim.
                    "spindle_rpm": p.get("spindle_rpm"),
                })
            issues = list(self._issues)
            parts = list(self._parts)
        source = self._line_source(stations)
        return {"ts": now, "stations": stations, "kpi": self._kpi,
                "issues": issues, "parts": parts, "source": source}

    @staticmethod
    def _line_source(stations: list) -> str:
        """Collapse per-station provenance into one line-level badge value.

        Any live real source wins over simulated; if both are present it's
        "mixed". Offline stations don't vote. Empty line reads "simulated".
        """
        live = {s.get("source", "simulated") for s in stations if s.get("online")}
        real = {s for s in live if s.startswith("real_") or s == "historical_replay"}
        if real and (live - real):
            return "mixed"
        if real:
            return sorted(real)[0] if len(real) == 1 else "mixed"
        return "simulated"

    async def _broadcast_loop(self):
        loop = asyncio.get_event_loop()
        while True:
            # Guard the ENTIRE tick: a single exception here (a bad snapshot, a
            # KPI hiccup) must never kill this task — if it does, the live feed
            # silently dies for every client while HTTP keeps working (the exact
            # failure we hit once). Nothing in one tick is worth losing the loop.
            try:
                # The KPI recompute (stations × historian queries) is the only
                # heavy work here — run it in a thread so a slow query can never
                # block the event loop (which would stall WS handshakes and all
                # HTTP). It is throttled to kpi_every_s, so most ticks are no-ops.
                try:
                    await loop.run_in_executor(None, self._refresh_kpi)
                except Exception:  # noqa: BLE001
                    pass
                snap = self._snapshot()
                for ws in list(self._clients):
                    try:
                        await ws.send_json(snap)
                    except Exception:  # noqa: BLE001
                        self._clients.discard(ws)
            except Exception:  # noqa: BLE001 - never let the broadcast loop die
                pass
            await asyncio.sleep(1.0)
