# Frontend Design & Build Specification — Real-Time Factory Digital Twin
### The target look, behaviour, and information architecture for the UI — grounded in how the commercial systems do it, mapped to the data our backend actually produces.
**Version:** 1.0 · **Date:** 2026-09-03 · **Feeds:** Claude Code (build to this spec, screen by screen)

---

## 0. How to use this file

This is the **single source of truth for the frontend.** It tells Claude Code *what to build and to what standard*, not just "make a dashboard." Read it top to bottom, then build **one screen at a time** against the acceptance checklist in Section 9. Do **not** invent new data — every panel here is wired to an endpoint that already exists (Section 2). Keep the working data layer (`api.ts`, `types.ts`, the FastAPI backend) unchanged; this spec is about the **presentation layer only.**

The guiding sentence for the whole build:

> **It should look like an operations console a plant manager would trust — calm, dense, disciplined — not like a demo. Restraint is the aesthetic.**

---

## 1. What the reference systems actually are (borrow the principle, not the pixels)

We are inspired by four commercial worlds. Each is worth billions and took hundreds of engineers; we replicate the **principles**, not the implementation. Here is the honest mapping of what to take and what to skip.

### 1.1 NVIDIA Omniverse — *industrial facility digital twins*
**What it is:** a real-time, physically-accurate **3D** digital-twin platform built on **OpenUSD** (the scene/asset format) and **RTX** ray-traced rendering, now packaged for factories as the *Omniverse DSX Blueprint for AI-factory digital twins* with *SimReady* assets and published *reference architectures*.
**What it requires:** RTX Pro / data-center GPUs, a USD asset pipeline, Kit-based applications — i.e. heavy graphics infrastructure and 3D content authoring.
**What we borrow:** the *idea* of a **spatial view with live status painted onto it**, and a walkthrough/inspection feel. **What we explicitly skip:** photoreal 3D, USD, RTX. Our version is a **clean 2D / light-2.5D floor map** (Section 4, Screen A). A 2D SVG floor plan delivers ~80% of the "see the factory, see the problem" impact for ~2% of the effort — chasing 3D would sink the project. *This is a firm scope boundary, restated in Section 10.*

### 1.2 Siemens Tecnomatix Plant Simulation — *discrete-event simulation & optimization*
**What it is:** a **discrete-event simulation** tool that models production lines, material flow, buffers, and resources, then analyzes **throughput, utilization, and bottlenecks**. Its UI is a model canvas plus an **Event Controller** (play / pause / speed), a **statistics/chart** layer (throughput curves, **Sankey material-flow** diagrams, a **bottleneck analyzer** that colors the worst resources), and an **Experiment Manager** for what-if / scenario comparison.
**What it requires:** the simulation engine (we have **SimPy**) and a model of the cell.
**What we borrow:** the **simulate + experiment** mental model — a *baseline vs. scenario* comparison, a bottleneck that is **visually flagged**, and KPI overlays (Tecnomatix literally shows "Produced Units / Throughput per year / Throughput per day" floating on the model). This maps directly to our `/api/simulate/*` endpoints (Section 4, Screens C & D).

### 1.3 Rockwell FactoryTalk + PTC ThingWorx — *real-time operational monitoring (IIoT)*
**What it is:** IIoT platforms that ingest machine data and present **real-time operator dashboards**. PTC's reference *Operator Dashboard* is built from a fixed set of panes: **Shift OEE**, **Active Work Order / Product**, **Operating Mode**, **Downtime**, and **Production & Waste**, with equipment selection. FactoryTalk adds machine-state timelines, alarms, and trend widgets.
**What it requires:** IIoT connectivity + a "mashup" builder.
**What we borrow:** this is the **closest thing to what we're building** — take the whole information architecture. Our Live Overview (Screen A) is essentially this operator dashboard, wired to `/ws/live` + `/api/kpi/*`.

### 1.4 The design standard nobody mentions but everybody follows — ISA-101 / High-Performance HMI
This is *why* those dashboards look professional and ours currently doesn't. The **High-Performance HMI** philosophy (standardized as **ISA-101**) is a strict discipline:

- **A muted, low-saturation base.** Backgrounds and structure are neutral grey/slate and *recede*. "Boring is good."
- **Colour is reserved for meaning.** Saturated colour means **a state or an alarm** — never decoration, never "brand wallpaper." A healthy screen is mostly quiet; when red appears, it *dominates*.
- **Redundant encoding.** State is shown in **at least two channels** — colour **and** a label/icon/shape — so it survives colour-blindness (~8% of men) and glance-reading.
- **Report by exception.** The issues/alarm feed shows only what needs attention; a calm screen means a healthy line.
- **≤ 5–7 primary KPIs** on the overview, each **with context** (a target and/or a trend) — a number with no reference point is meaningless.
- **One Level-1 overview screen that fits without scrolling**, then drill down for detail.

**Our current UI violates most of these** (saturated navy + green + blue used decoratively, colour not tied to meaning, weak hierarchy, no context on numbers). Fixing that discipline — not adding features — is what moves it from "student project" to "ThingWorx-class." Sections 3–9 encode this discipline as buildable rules.

---

## 2. The data we actually have (every panel must bind to this)

The backend is already built and correct. The frontend must render **only** these shapes. (Verified against `backend/app`.)

### 2.1 Live WebSocket — `WS /ws/live` (pushes ~1 Hz)
```jsonc
{
  "ts": 1756881600.0,
  "stations": [
    { "station_id": "S1", "state": "running", "current_a": 4.7,
      "part_count": 1042, "cycle_time_s": 86.2, "part_present": true }
  ],
  "kpi": {
    "stations": { "S1": { "oee": 0.78, "availability": 0.92, "performance": 0.94,
                          "quality": 0.99, "utilization": 0.81 } },
    "line": { "units_per_hr": 41.0, "terminal_station": "S4" }
  },
  "issues": [ { "ts": "...", "station_id": "S3", "event_type": "down", "reason": "jam" } ]
}
```
`state` ∈ `running | idle | blocked | down`.

### 2.2 REST endpoints
| Endpoint | Returns | Feeds |
|---|---|---|
| `GET /api/stations` | `[{station_id, state, last_seen}]` | rail, floor (initial) |
| `GET /api/kpi/oee?station=&window=` | `{oee, availability, performance, quality, utilization, note?}` | station detail |
| `GET /api/kpi/throughput?line=&window=` | `{units_per_hr, good_count, terminal_station, series:[{units_per_hr,...}]}` | throughput trend |
| `GET /api/timeline/{station}?window=` | `[{start, end, state, duration_s}]` | state timeline (Gantt) |
| `GET /api/analyze/bottleneck?line=&window=` | `{bottleneck, utilization, sim_units_per_hr}` | bottleneck flag |
| `POST /api/simulate/whatif` | `{baseline:{units_per_hr,bottleneck:{bottleneck,utilization}}, predicted:{…}, delta_pct, delta_units_per_hr}` | What-If |
| `GET /api/simulate/validate?line=&window=` | `{sim_throughput_units_per_hr, real_throughput_units_per_hr, error_pct}` | Validation |
| `GET /api/calibrations?line=&limit=` | `[{…versioned param sets over time}]` | Calibration history |
| `POST /api/calibrate` | new param set | "recalibrate now" button |

**Rule:** if a panel needs a field not in this table, it is out of scope — do not fake it. (The one known gap: **Quality** has no retrofit sensor behind it — render it, but label it `assumed` when `quality_measured` is false, per the plan's OEE note.)

---

## 3. Design system (the exact tokens — this is where "proper" is won or lost)

Keep the dark theme (it reads well for a control room) but **re-discipline it.** Define these as CSS variables once and use nothing else. (The current `styles.css` is close; tighten it to these.)

### 3.1 Surfaces & ink — neutral, low-saturation, they recede
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0d1117` | app background (near-neutral, not blue) |
| `--surface` | `#161b22` | cards, rail |
| `--surface-2` | `#1c232d` | insets, tracks, hover |
| `--border` | `#2a313c` | 1px hairlines |
| `--ink` | `#e6edf3` | primary text/values |
| `--ink-muted` | `#9aa5b1` | labels, secondary |
| `--ink-dim` | `#6b7482` | axis, captions, units |
| `--accent` | `#4a9eff` | **one** brand accent — selection, links, the live/primary line only. Never as a status. |

### 3.2 Status scale — the ONLY saturated colours, and they mean exactly one thing
| State | Token | Hex | Icon (redundant encoding — always paired) |
|---|---|---|---|
| Running / good | `--st-run` | `#3fb950` | ● / ▶ |
| Idle / starved (warning) | `--st-idle` | `#d29922` | ◐ / "IDLE" |
| Blocked (serious) | `--st-block` | `#db6d28` | ▮ / "BLOCK" |
| Down (critical) | `--st-down` | `#f85149` | ■ / "DOWN" |

Rules (non-negotiable, from ISA-101 + dataviz):
- These four colours appear **only** to encode machine state or an alarm. Cards, charts-chrome, headers, borders, KPI numbers in a normal state = **neutral ink**, never a status colour.
- **Every** use of a status colour is **paired with a text label or icon** — never colour alone (colour-blind + glance safety).
- KPI values turn a status colour **only when the KPI itself is out of band** (e.g. OEE < 0.60 → `--st-down` text). A healthy overview is almost entirely neutral with small green accents.
- Amber (`#d29922`), not yellow, for "caution" — it survives red-green colour-blindness.

### 3.3 Chart colours
- **Single-series** (throughput trend, one line): use `--accent`, no legend (the title names it).
- **State timeline / utilization**: use the **status scale** above (they encode state).
- **OEE-components trend** (Availability/Performance/Quality, 3 series): use a **validated categorical palette** — do not hand-pick. Run `node scripts/validate_palette.js "<hexes>" --mode dark` and only ship a passing set; always add a legend + direct labels (identity never by colour alone).
- **One axis per chart. Never a dual-axis chart.** Two measures of different scale → two charts or index to a common base.

### 3.4 Type & space
- Font: system UI / Inter, sans-serif. Sizes: KPI value **28–34px/700**, KPI label **11px/700 uppercase, letter-spacing .5px, muted**, card title **11px uppercase muted**, body **13px**, caption **11px dim**.
- Spacing on an **8px grid** (8/12/16/24). Card padding 16px, gap 14–16px. Radius: cards 12–14px, controls 8–10px, data-ends 4px.
- Hairline borders (1px `--border`), soft shadow only on cards. No heavy drop-shadows, no gradients-as-decoration.

### 3.5 Marks (from the dataviz method)
Thin marks; 2px lines; ≥8px dots; bar/area data-ends rounded 4px and anchored to the baseline; a 2px surface gap between adjacent/stacked fills; recessive grid (dashed, `--border`); selective direct labels (never a number on every point). **Every** line/area chart ships a crosshair+tooltip; every bar/cell ships a per-mark hover tooltip.

---

## 4. Information architecture & screens

**Global shell** (persistent): a left **rail**, a top **bar**, a main content area. One accent, lots of neutral.

```
┌────────────┬─────────────────────────────────────────────────────────┐
│  BRAND     │  TOPBAR: [Line L1 ▾] [Window 1h ▾]   ●Live   tabs        │
├────────────┼─────────────────────────────────────────────────────────┤
│  RAIL      │  MAIN (one screen at a time)                             │
│  station   │  ┌── Overview / Station / What-If / Validation ──┐       │
│  list with │  │                                               │       │
│  status +  │  │                                               │       │
│  OEE mini  │  │                                               │       │
│  donuts    │  └───────────────────────────────────────────────┘       │
└────────────┴─────────────────────────────────────────────────────────┘
```
- **Rail** (`GET /api/stations` + live `state`/`kpi`): one row per station — status dot + label, station id, a **mini OEE donut**, part count. Selecting a row drives every screen (single selection state, lifted to the app).
- **Topbar:** line selector, **time-window selector** (15m / 1h / 8h / shift) that every panel respects, a **live indicator** (green pulse = WS connected; amber "reconnecting" on drop), and the screen tabs.

### Screen A — **Live Overview** (the Level-1 screen; must fit 1920×1080 with no scroll)
The operator dashboard. Top-to-bottom:

1. **KPI strip — exactly 6 tiles**, each a number **with context**:
   | Tile | Value (source) | Context shown |
   |---|---|---|
   | **OEE** | `kpi.stations[sel].oee` | vs target (e.g. 85%) + 24-tick sparkline; value goes status-coloured only if low |
   | **Availability** | `.availability` | small A·P·Q breakdown caption |
   | **Performance** | `.performance` | " |
   | **Quality** | `.quality` | badge `measured`/`assumed` |
   | **Throughput** | `kpi.line.units_per_hr` | "terminal `terminal_station`" + sparkline |
   | **Bottleneck** | `/api/analyze/bottleneck.bottleneck` | its utilization %, amber |
   *(6 tiles = within the 5–7 rule. Do not add more to this row.)*

2. **Live floor map** (`FloorMap`, `stations[]` + live `state`, + bottleneck): 2D top-down cell — conveyor, stations as blocks, buffers between. Each station block: id, **status colour + state label** (redundant), part count, current (A), cycle (s). Selected station ringed in `--accent`; bottleneck flagged "▲ BOTTLENECK." Click → selects station. *This is our "Omniverse," done in 2D.*

3. **Two columns below the floor:**
   - **Left — Machine-state timeline** (multi-row Gantt, `GET /api/timeline` per station): one row per station, horizontal segments coloured by state over the window. This is the single most recognizable "factory monitoring" visual — get it clean. Legend below. Hover a segment → state + duration.
   - **Right (stacked):** **Throughput trend** (area, `--accent`, live series) and **Recent stops** (`issues[]`, report-by-exception: station · reason · time, newest first; empty state = "No stoppages in window ✓" in muted green).

### Screen B — **Station detail** (drill-down; opens as a right **drawer** or a tab when a station is selected)
- Big **OEE gauge** (`Donut`) + A / P / Q as three small meters with their formulas.
- **Cycle-time** readout + a small distribution/histogram (from timeline/telemetry) — "how consistent is this station."
- **Live current (A) sparkline** — shows the retrofit signal that state is inferred from (nice for the paper/jury: "this is the raw sensor").
- **This station's state timeline** (single row, full width) + **its stops** list.
- All bound to `GET /api/kpi/oee?station=sel` and `GET /api/timeline/sel`.

### Screen C — **What-If** (the Tecnomatix "Experiment Manager", `POST /api/simulate/whatif`)
- **Left — change builder:** station selector, change type (`cycle_reduction %` / `add_operator` / `buffer_size`), parameter input, replications, "Run what-if." Deterministic-seed toggle for repeatable demos.
- **Right — result:** **baseline vs predicted** as a paired comparison — predicted throughput big, **Δ%** prominent (green up / red down, with ▲/▼ **and** sign so it's not colour-alone), and **bottleneck before → after** with utilizations. A small paired bar (baseline vs predicted units/hr).
- Copy under it: "Clones the calibrated twin, applies the change, runs N replications, predicts the new throughput — before you touch the real line." *(This is a headline demo screen — make it feel decisive.)*

### Screen D — **Twin validation & calibration** (the patent/paper evidence — give it a real screen)
- **Validation:** `GET /api/simulate/validate` → **sim vs real throughput** side by side + **error %** as the hero number (with a pass/fail band: ≤10% good). One paired bar.
- **Calibration history:** `GET /api/calibrations` → a small-multiple or line showing how the fitted parameters (cycle-time mean, downtime rate) **track over time** — the visual proof that "the twin auto-corrects to reality." A **"Recalibrate now"** button (`POST /api/calibrate`).
- This screen is what makes the twin *credible* to a jury/reviewer; it is not optional.

---

## 5. Real-time behaviour

- **Live source of truth:** the `/ws/live` snapshot at ~1 Hz updates the rail, floor, and KPI live values. Throttle React re-renders to ~1–2 Hz; never thrash.
- **Windowed data** (timelines, throughput series, OEE) refresh on an interval (5–8 s) and on window/line/selection change.
- **Selection is global:** rail ↔ floor ↔ detail all read/write one `selectedStation`.
- **Connection state is always visible:** green pulse (live) / amber "reconnecting…" (the WS auto-reconnects — surface it, don't hide it).
- **Motion encodes state, not decoration:** a running station may show a subtle pulse; transitions are ≤200ms ease. No gratuitous animation (ISA-101).
- **Every panel has three explicit states:** *loading* (skeleton), *empty* ("waiting for telemetry…" / "no stoppages ✓"), *error* (quiet inline message, never a blank crash). This alone separates "proper" from "demo."

---

## 6. Component inventory (what Claude Code builds — reuse what exists)

You already have good versions of several of these (`FloorMap`, `Donut`, `StatesGantt`, `MachineRail`, `charts`). Refine them to the tokens in Section 3; build the missing ones.

| Component | Purpose | Key props | Source | Have it? |
|---|---|---|---|---|
| `Shell` / `TopBar` / `Rail` | layout, selectors, live badge | line, window, connected, selected | app state | rail ✅ |
| `KpiTile` | number + label + **context** (target/sparkline) | label, value, unit, target?, series?, tone | kpi.* | build |
| `Sparkline` | inline 24–60pt micro-trend, no axes | data | series | build |
| `Donut` / `Gauge` | OEE / A·P·Q | value, label, size, tone | kpi | ✅ |
| `StatusPill` | state as **colour + label + icon** | state | state | build |
| `FloorMap` | 2D live cell | stations, selected, bottleneck, onSelect | ws | ✅ (refine) |
| `StateTimelineGantt` | multi-row state bars | ids, timelines, onSelect | /timeline | ✅ (`StatesGantt`) |
| `TrendChart` | single-series area w/ crosshair | data | series | ✅ (`ThroughputChart`) |
| `IssuesFeed` | report-by-exception list | issues | ws.issues | build |
| `WhatIfBuilder` + `DeltaStat` | scenario form + result | changes, result | /whatif | partial |
| `ValidationPanel` + `CalibrationHistory` | sim-vs-real, param drift | validate, calibrations | /validate,/calibrations | build |
| `StationDrawer` | drill-down detail | station | /kpi/oee,/timeline | build |

---

## 7. Reference-visual cheat sheet (what "good" looks like, from the systems we studied)

- **PTC/FactoryTalk:** KPI tiles + machine list + downtime + production; state timeline; alarms by exception. → our Screen A.
- **ifm moneo / Autodesk Tandem:** floor/plan with status pins, OEE + throughput + issues tiles, "streams with issues over time," maintenance/parameters tables. → our floor + KPI strip + issues.
- **TeepTrak / MachineMetrics:** machine-states timeline (green/amber/red), top stop reasons, MTBF/MTTR, OEE donut. → our timeline + stops + gauge.
- **Tecnomatix:** event controller, throughput/utilization stats, bottleneck highlight, experiment manager. → our What-If + Validation.
- **Omniverse:** spatial live twin. → our 2D floor map (principle only).

The through-line in *all* of them: **calm neutral canvas, one status language, dense but ordered, every number in context.**

---

## 8. Explicit non-goals (scope guard — do not do these)

1. **No photoreal / 3D / WebGL floor.** 2D or light-2.5D SVG only.
2. **No more than ~7 KPIs** on the overview.
3. **No status colour used decoratively** — no coloured card headers "for looks," no rainbow charts, no brand-colour wallpaper.
4. **No colour-only encoding** — always colour + label/icon.
5. **No fabricated data** — bind to Section 2 or don't show it. Quality shows `assumed` when unmeasured.
6. **No `localStorage`-dependent state** for live data.
7. **No dual-axis charts.**

---

## 9. Acceptance checklist ("definition of good" — Claude Code must pass all)

**Layout & hierarchy**
- [ ] Live Overview fits 1920×1080 with **no vertical scroll**; drill-down is a separate screen/drawer.
- [ ] Exactly 6 KPI tiles on the overview; each shows a value **and** a target or trend.
- [ ] Consistent 8px spacing grid; all cards share one radius, border, padding.

**Colour discipline**
- [ ] The only saturated colours on a *healthy* screen are small green status dots + the accent line.
- [ ] Every status colour is paired with a label/icon (screenshot in greyscale → still readable).
- [ ] Categorical chart palette (if any) passes `validate_palette.js` in **dark** mode.

**Data correctness**
- [ ] Every panel binds to a real field in Section 2; no placeholder/fake series in the running app.
- [ ] Quality shows `measured`/`assumed` correctly.
- [ ] Bottleneck station matches `/api/analyze/bottleneck`; selection syncs rail↔floor↔detail.

**Real-time & robustness**
- [ ] Live values update ≤2s after a WS message; reconnect indicator works when the API is stopped/started.
- [ ] Every panel has loading, empty, and error states (kill the backend → no white crash).

**Build health**
- [ ] `npm run build` passes clean (tsc + vite), **zero** missing-export or type errors.
- [ ] No unused/dead components imported; no console errors on load.

**Final visual QA**
- [ ] Screenshot the Overview and the What-If screen; they read as calm, ordered, professional — comparable to the reference dashboards, not a demo.

---

## 10. Ready-to-paste Claude Code build brief

> Read `docs/Frontend_Design_Spec.md` in full. You are rebuilding the **frontend presentation only** — keep `api.ts`, `types.ts`, and the FastAPI backend exactly as they are (the data layer is correct and verified).
>
> First, restate the design tokens (Section 3) and the Screen A layout (Section 4) back to me so we agree. Then implement in this order, stopping after each for me to look:
> 1. Design tokens in `styles.css` + the `Shell`/`TopBar`/`Rail` + `KpiTile`/`Sparkline`/`StatusPill`.
> 2. **Screen A (Live Overview)** end-to-end, bound to `/ws/live` + `/api/kpi/*` + `/api/timeline` + `/api/analyze/bottleneck`. Make it pass the Section 9 checklist before moving on.
> 3. Screen C (What-If) and Screen D (Validation & Calibration).
> 4. Screen B (Station detail drawer).
>
> Obey the non-goals (Section 8): 2D only, ≤7 KPIs, colour = state only + always with a label, no fake data, no dual-axis, one accent. Reuse the existing `FloorMap`, `Donut`, `StatesGantt`, `MachineRail`, `charts` — refine them to the tokens, don't rewrite from scratch. Run `npm run build` clean after each screen and fix every type/missing-export error (that class of bug is what broke the last build). Commit per screen.

---

*Sources studied for this spec: NVIDIA Omniverse industrial digital-twin docs, Siemens Tecnomatix Plant Simulation, PTC ThingWorx Operator Dashboard, ISA-101 / High-Performance HMI colour & layout guidance, and real-time OEE-dashboard design guides. Links are in the chat message that delivered this file.*
