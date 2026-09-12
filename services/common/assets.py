"""Asset / metadata registry loader (build plan backlog D2).

Reads config/assets.yaml — static per-station facts (name, type, nameplate cycle,
maintenance schedule, service provider) that live telemetry doesn't carry. If a
station has no entry, a sensible default record is synthesized from its id so the
UI never breaks on an un-registered machine.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _config_path() -> Path:
    return Path(os.getenv("ASSETS_PATH", str(_REPO_ROOT / "config" / "assets.yaml")))


@lru_cache(maxsize=1)
def _load() -> dict:
    path = _config_path()
    if not path.exists():
        return {"lines": {}}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {"lines": {}}


def _default_record(station_id: str) -> dict:
    return {
        "id": station_id,
        "name": station_id,
        "type": "station",
        "ideal_cycle_s": None,
        "next_maintenance_due": None,
        "service_provider": None,
    }


def line_ids() -> List[str]:
    """All configured line ids, in file order."""
    return list((_load().get("lines", {}) or {}).keys())


def line_name(line_id: str) -> Optional[str]:
    if line_id == "ALL":
        return "Plant 1 — all lines"
    return (_load().get("lines", {}).get(line_id, {}) or {}).get("name")


def line_product(line_id: str) -> Optional[str]:
    """The product family a line builds (e.g. 'car'), so the 3D can show the right
    transforming unit. None for ALL or unset (defaults to the generic housing)."""
    if line_id == "ALL":
        return None
    return (_load().get("lines", {}).get(line_id, {}) or {}).get("product")


def get_assets(line_id: str = "L1") -> List[dict]:
    """Return the registry rows for a line (may be empty).

    `line_id="ALL"` merges every configured line so the plant view can render the
    whole factory (multiple assembly lines) from a single call.
    """
    if line_id == "ALL":
        out: List[dict] = []
        for lid in line_ids():
            out.extend(get_assets(lid))
        return out
    line = _load().get("lines", {}).get(line_id, {}) or {}
    return list(line.get("stations", []) or [])


def asset_map(line_id: str = "L1") -> Dict[str, dict]:
    return {s["id"]: s for s in get_assets(line_id) if "id" in s}


@lru_cache(maxsize=1)
def station_line_map() -> Dict[str, str]:
    """station_id -> line_id for every configured station.

    Lets the live snapshot tag each station with the line it belongs to, so the
    UI can filter the floor / rail to the selected plant without a second fetch.
    """
    out: Dict[str, str] = {}
    for lid in line_ids():
        for s in get_assets(lid):
            sid = s.get("id")
            if sid:
                out[sid] = lid
    return out


def get_asset(line_id: str, station_id: str) -> dict:
    """Registry row for one station, or a synthesized default."""
    return asset_map(line_id).get(station_id) or _default_record(station_id)


def get_layout(line_id: str = "L1") -> dict:
    """Spatial layout for a line: flow edges + zones (spec §10). Stations carry
    their own x/z in get_assets(). `line_id="ALL"` merges every line's flow +
    zones for the whole-plant view."""
    if line_id == "ALL":
        flow: List = []
        zones: List = []
        for lid in line_ids():
            lay = get_layout(lid)
            flow.extend(lay["flow"])
            zones.extend(lay["zones"])
        return {"flow": flow, "zones": zones}
    line = _load().get("lines", {}).get(line_id, {}) or {}
    return {"flow": line.get("flow", []) or [], "zones": line.get("zones", []) or []}
