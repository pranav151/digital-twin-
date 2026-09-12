"""Factory copilot — natural-language questions over the twin (backlog F1).

An operator asks "why is S3 the bottleneck?" or "what if I speed S3 up 20%?" and
Claude answers by calling the SAME REST engine the dashboard uses, via tool-use.
This is the Omniverse-DSX "AI agent" idea at ~0 GPU cost — it runs on our API.

Degrades gracefully: if the `anthropic` SDK isn't installed or no credential is
configured on the backend, /api/ask returns available=false with a hint instead
of erroring, so the UI can show a "copilot off" state.
"""

from __future__ import annotations

import json
import os

MODEL = os.getenv("COPILOT_MODEL", "claude-opus-5")

SYSTEM = (
    "You are the operations copilot for manufacturing Line L1, a real-time digital "
    "twin of a 4-station cell (S1..S4). Answer the operator's question by calling the "
    "tools to fetch LIVE data — never invent numbers. Be concise and concrete: give the "
    "figure and one sentence of insight. Throughput is units/hr; cycle/MTBF/MTTR are "
    "seconds; OEE/availability/utilisation are fractions 0..1. If asked to improve the "
    "line, use the optimizer or a what-if and state the predicted gain."
)

TOOLS = [
    {"name": "list_stations", "description": "Current live state of every station.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_kpi", "description": "OEE / availability / performance / quality / utilisation / MTBF / MTTR for one station.",
     "input_schema": {"type": "object", "properties": {"station": {"type": "string"}, "window": {"type": "string"}},
                      "required": ["station"]}},
    {"name": "get_bottleneck", "description": "The current bottleneck station and its utilisation.",
     "input_schema": {"type": "object", "properties": {"window": {"type": "string"}}}},
    {"name": "get_throughput", "description": "Line throughput in units/hr and the terminal station.",
     "input_schema": {"type": "object", "properties": {"window": {"type": "string"}}}},
    {"name": "get_losses", "description": "Time lost by cause (blocked/idle/down + reason) and good count.",
     "input_schema": {"type": "object", "properties": {"window": {"type": "string"}}}},
    {"name": "run_whatif", "description": "Predict throughput if a station's cycle time is reduced by a percentage.",
     "input_schema": {"type": "object", "properties": {"station": {"type": "string"}, "percent": {"type": "number"}, "window": {"type": "string"}},
                      "required": ["station", "percent"]}},
    {"name": "optimize", "description": "Search changes and return the single highest-impact recommendation.",
     "input_schema": {"type": "object", "properties": {"window": {"type": "string"}}}},
]


def copilot_available() -> bool:
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


def _dispatch(engine, name: str, args: dict, window: str) -> dict:
    w = args.get("window", window)
    if name == "list_stations":
        return {"stations": engine.stations()}
    if name == "get_kpi":
        return engine.oee(args["station"], w)
    if name == "get_bottleneck":
        return engine.bottleneck("L1", w)
    if name == "get_throughput":
        return engine.throughput("L1", w)
    if name == "get_losses":
        return engine.losses("L1", w)
    if name == "run_whatif":
        return engine.whatif("L1", w, [{"type": "cycle_reduction",
                                        "station": args["station"], "percent": args["percent"]}], replications=6)
    if name == "optimize":
        return engine.optimize("L1", w)
    return {"error": f"unknown tool {name}"}


def ask(engine, question: str, window: str = "1h") -> dict:
    if not copilot_available():
        return {"available": False,
                "answer": "The copilot is off. Install `anthropic` and set ANTHROPIC_API_KEY "
                          "on the backend, then restart it."}
    import anthropic

    client = anthropic.Anthropic()
    messages = [{"role": "user", "content": question}]
    used = []
    for _ in range(6):
        resp = client.messages.create(
            model=MODEL, max_tokens=1200, system=SYSTEM, tools=TOOLS,
            output_config={"effort": "low"}, messages=messages,
        )
        if resp.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for block in resp.content:
                if block.type == "tool_use":
                    used.append(block.name)
                    out = _dispatch(engine, block.name, block.input or {}, window)
                    results.append({"type": "tool_result", "tool_use_id": block.id,
                                    "content": json.dumps(out, default=str)})
            messages.append({"role": "user", "content": results})
            continue
        text = "".join(b.text for b in resp.content if b.type == "text")
        return {"available": True, "answer": text.strip(), "tools_used": used}
    return {"available": True, "answer": "(the copilot ran out of steps)", "tools_used": used}
