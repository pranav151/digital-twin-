# Project review — 14 September 2026

## Assessment

This is an implemented manufacturing monitoring and simulation prototype, with a substantial visualization layer. Its strongest foundation is the separation between MQTT producers, historian storage, KPI computation, and the SimPy model. The original four-station emulator workflow is reproducible. The main weakness is that the product has expanded to multiple plants, seven states, and real protocol connectors while several analytics and UI paths still implement the original four-station assumptions.

The next milestone should be trustworthy end-to-end measurements on one configured production line, followed by a real-cell pilot. More showcase geometry will have less value than fixing the data and model inconsistencies below.

This review covers the active application, shared contracts, connectors, inference, emulator, firmware and Node-RED paths, configuration, launch scripts, tests, validation documents, and reference implementation boundaries. The large procedural 3D implementation was inspected structurally and at its data/animation interfaces; individual mesh coordinates and binary models were not exhaustively verified. No physical machine, external connector endpoint, live InfluxDB deployment, or browser rendering was tested. Application source was not changed; this report is the review deliverable.

## How the project works

| Area | Role and current implementation |
|---|---|
| `edge/emulator` | Seeded, tick-based serial production line with finite buffers, processing, breakdowns, planned maintenance, current signatures, counters, and part exits. YAML scenarios include the original cell, expanded lines, representative automotive/engine lines, and warehouse. |
| `edge/firmware` | ESP32 samples CT current and an IR sensor and publishes raw MQTT messages. It is a retrofit acquisition prototype. |
| `services/connectors` | OPC-UA subscriptions, MTConnect polling, and Modbus register reads normalize external signals into telemetry. |
| `services/inference` | Rolling two-cluster current calibration, smoothing and debounce infer four states; accumulated running time per counter increment estimates processing time. |
| `services/common` | Pydantic contracts, MQTT topic helpers, environment configuration, asset/layout metadata, and SQLite/InfluxDB historian implementations. |
| `services/ingestion` | Validates telemetry/events, writes synchronously to the selected historian, and prunes SQLite history. |
| `backend/app/kpi` | Reconstructs state durations, computes station OEE, line throughput, loss summaries, and heuristic health scores. |
| `backend/app/twin` | Fits normal cycle distributions and reliability estimates, simulates a serial line, compares what-if changes, and stores calibration snapshots. |
| `backend/app/ws` | Consumes MQTT for immediate station snapshots; periodically queries historian KPIs and broadcasts to browsers. |
| `backend/app/copilot.py` | Optional Anthropic tool-use interface to the KPI and simulation engine. Its scope is currently hardcoded to L1. |
| `frontend` | React dashboard, line selection, timelines, charts, what-if, calibration/validation, copilot, and React Three Fiber floor scenes. |
| `reference` | Separate earlier connector/state-engine design, dataset calibration examples, and CAD conversion scripts. It is not the active MQTT application. Its schema is different. |
| `scripts` / `infra` | Local process launch/stop helpers, offline validation tools, broker configuration, and Docker infrastructure. Docker Compose does not deploy the full application. |

The operational path is: emulator or connector → MQTT telemetry/events → ingestion → historian → KPI/calibration/simulation → REST and WebSocket → dashboard. Retrofit raw messages pass through inference before re-entering that path. The visual scene is partly driven by telemetry and partly by illustrative animation.

## Verification performed

| Check | Result |
|---|---|
| `./.venv/bin/python -m pytest backend/tests -q` | 43 passed; 8 FastAPI lifecycle deprecation warnings. |
| `npm run build` in `frontend` | Passed. Main JS chunk: 1,848.89 kB minified, 540.42 kB gzip; bundle-size warning. |
| `scripts/closed_loop_demo.py` | Reproduced 63.45 baseline, 85.21 predicted, 84.16 modified-emulator units/hr; 1.26% prediction error. This is emulator evidence. |
| `scripts/inference_eval.py --scenario normal` | 99.1% overall state accuracy; 1.7% cycle error. |
| `scripts/inference_eval.py --scenario bottleneck` | 85.1% overall state accuracy; 1.5% cycle error. |
| `scripts/inference_eval.py --scenario breakdown` | 79.2% overall state accuracy; 2.0% cycle error. |
| Isolated telemetry-only timeline | Running at 0 s, down at 50 and 100 s → engine reported 100 s running. |
| Isolated topology fit | S1, S2, S10, S15 → simulated order S1, S10, S15, S2. |
| Isolated counter reset | Counts 0 → 5 → 0 → 3 → OEE used 3 parts, throughput used 8. |
| Isolated line filtering | Health request for L1 returned both L1/S1 and L2/S18. |
| Accelerated emulator events | A 120-second advance generated 8 events with only one distinct event timestamp. |
| Invalid API inputs | Invalid window and zero replications both returned HTTP 500. |
| Installed Modbus interface | Installed reader accepts `device_id`; connector passes `slave`. |

The tests mainly cover deterministic unit behavior and offline connector mappings. Passing them does not establish correct full-stack behavior for the expanded configuration.

## Priority 1 — correctness before relying on the dashboard

### 1. Make every panel honor the selected line and window

Evidence: `frontend/src/App.tsx:110`, `pages/WhatIf.tsx:31`, `pages/Validation.tsx:72`, `components/HealthPanel.tsx:15`, `backend/app/copilot.py`, `backend/app/ws/live.py:26`.

The app defaults to BMW_X5, but what-if, optimization, calibration, validation, and copilot still use L1. What-if receives station IDs from every line, so selecting a BMW station can send an unknown station into the L1 model. Health also ignores its line argument in the backend. Headline OEE comes from a fixed 15-minute WebSocket calculation even when the user selects 1h or 8h. The throughput chart remains plant-wide, and utilization bars receive all stations.

Use one explicit query context: line, station, window, and data mode. Pass it through every page, request, cache key, and WebSocket subscription. Define ALL aggregation deliberately; several backend methods currently treat ALL as a literal line ID and find no rows. Clear or label old results when context changes. Acceptance: select two lines with deliberately different data and verify every panel and request follows the selection.

### 2. Repair the real-connector event contract

Evidence: `services/connectors/base.py`, `backend/app/kpi/engine.py:49`, `edge/node-red/flow.json`.

The connector base publishes telemetry only; the KPI timeline reconstructs changes from events and otherwise holds the first telemetry state across the entire interval. Consequently, live state can look right while availability, downtime, MTBF/MTTR and calibration are wrong. The Node-RED route has the same gap.

Emit canonical state transitions from connectors, or centralize transition derivation in ingestion with telemetry fallback. Preserve source timestamps and make event/telemetry reconciliation deterministic. Test connector → ingestion → timeline/OEE together, including disconnects and missed transitions.

### 3. Build the model from configured production flow

Evidence: `backend/app/twin/calibration.py:84`, `backend/app/kpi/engine.py:215`, `config/assets.yaml`.

Calibration sorts station IDs lexicographically, placing S10 before S2, and includes unrelated monitoring stations such as S15–S17 in the serial model. Throughput chooses the station with the smallest cumulative counter as the terminal instead of using topology. Reset counters, partial coverage, or different start times can change that choice.

Use the flow graph as the source of station order and terminal identity. Exclude independent monitored assets from the production model. Reject incomplete or unsupported topology with a useful explanation. Add branching, joins and parallel resources only when needed; initially guarantee correct serial graphs. Counter resets must never change which station defines output.

### 4. Resolve four-state inference versus seven-state telemetry

Evidence: `services/common/schemas.py`, `services/inference/inference.py`, `scripts/inference_eval.py:25`.

The emulator now emits starved and maintenance, but inference returns running/idle/blocked/down only. The current benchmark's overall scores include unmatched states while its printed confusion table omits them. This explains a substantial gap from the older documented accuracy; it is not evidence that the current classifier reproduces all seven states.

Define which states the retrofit sensors can actually distinguish. Use upstream/downstream context and maintenance schedules where needed, or explicitly evaluate a documented four-state projection. Report every ground-truth label, per-class precision/recall, startup behavior, and transition delay. Update the validation documents from saved benchmark outputs. Do not silently relabel states merely to improve accuracy.

### 5. Fix Modbus compatibility and connection freshness

Evidence: `services/connectors/modbus_connector.py:111`, `services/connectors/opcua_connector.py`, `services/connectors/runner.py`.

The installed Modbus API expects `device_id`, while `_poll_station` passes `slave`; the current tests only check register mapping and miss the call mismatch. OPC-UA publishes on data changes only, so a healthy constant-value machine can be marked offline after eight seconds. Initial MQTT connection failure in the runner is not retried despite its `run_forever` name.

Align and lock dependency versions; test the actual polling interface against a local protocol server. Track connector/session health separately from signal changes and publish heartbeats with source freshness. Add bounded retries, reconnect/resubscribe handling, and explicit degraded status.

### 6. Standardize time, coverage and retention

Evidence: `services/ingestion/main.py:48`, `services/common/historian.py:234`, `services/common/historian.py:362`.

Default SQLite retention is only 45 minutes, while the UI advertises 1h and 8h windows. SQLite queries anchor to the newest stored sample; Influx queries anchor to wall time. Accelerated emulator runs can push the shared SQLite anchor into the future, causing real data to disappear from queries or be pruned. Conversely, old SQLite data can continue to look like a recent window after collection stops.

Introduce explicit live/replay clock semantics, start/end query bounds, source and receive timestamps, coverage ratio, and last-seen metadata. Isolate accelerated experiments from live telemetry. Keep retention at least as long as supported windows and retain boundary state information. Show partial coverage and staleness instead of presenting incomplete windows as complete.

### 7. Preserve actual event times during accelerated simulation

Evidence: `edge/emulator/emulator.py:329` and `:532`.

Events generated at different internal simulation steps are all stamped when drained at the end of the outer advance. Fine physics steps therefore do not preserve fine event timing. The KPI engine ignores the event's `duration_s`, so that field does not repair the timestamp collapse.

Record simulation time at each transition and part exit, and serialize that captured time later. Acceptance: fine and coarse publish cadences produce equivalent state-duration totals and production counts for the same simulated run.

### 8. Unify count and cycle observations

Evidence: `backend/app/kpi/engine.py:95`, `backend/app/twin/calibration.py:89`, `edge/emulator/emulator.py:489`, `services/inference/main.py`.

OEE uses last-minus-first count while throughput sums positive increments. Bucketed throughput uses another calculation and can discard output across resets. Cycle fitting treats every repeated `last completed cycle` telemetry sample as a new observation, overweighting cycles followed by long waits or downtime.

Add completion IDs or sequence/session identifiers and fit once per completion. Share a reset-aware production accumulator across OEE, throughput and chart buckets. Handle rollover and restart explicitly; preserve a boundary counter sample. Return sample counts that mean independent completed cycles, not repeated telemetry rows.

## Priority 2 — make predictions credible and reproducible

### Calibration must have an active version and quality gates

The store appends parameter snapshots, but what-if, validation and optimization immediately refit from the historian rather than using an activated version. The standard full-stack launcher does not start the calibration loop. A successful recalibration button therefore does not select the model that subsequent predictions use.

Store full experiment provenance: time bounds, source, topology version, sample counts, code/config version, fit diagnostics and uncertainty. Support candidate → validated → active model versions, rollback, and frozen-model what-if runs. Reject insufficient cycle data instead of inventing a one-second processing fallback. Use drift thresholds and minimum evidence before promoting a new fit.

### Separate reconstruction accuracy from forecasting accuracy

`KPIEngine.validate` fits and compares against the same window. That is useful model reconstruction evidence, but it is not held-out forecasting. The closed-loop script goes further by predicting a modified emulator run; its reproduced 1.26% error should be labeled exactly that way. Documents and UI phrases such as “real cell delivered” overstate the current experiment.

Add chronological train/test windows, multiple seeds and scenarios, parameter-drift experiments, and comparisons with simpler baselines. Report confidence intervals and errors for throughput, state occupancy, WIP, downtime and lead time. Then repeat the before/after protocol on a measured physical cell.

### Improve the simulation assumptions

`backend/app/twin/model.py:81` includes repair delay in busy time, so the utilization used for bottleneck ranking includes downtime. It misses unfinished processing at the horizon boundary. Failures occur after a sampled cycle rather than interrupting it as in the emulator. Planned maintenance is not modeled. Every run starts empty, even if the calibration window represents a line already operating with WIP.

Track processing, failure, blocking and starvation separately; account for partial intervals. Add warm-up or observed initial conditions. Prefer empirical or positive-support cycle distributions when supported by data. Give each station separate random streams so baseline/scenario comparisons retain stronger pairing when event order changes.

The “add operator” change assumes cycle time divides by the new headcount. That can be meaningful for a fully labor-limited task but is unsupported for ovens, CNC cutting or fixed machine time. Model labor-limited and machine-limited portions, resource capacity, and intervention constraints. Rank recommendations by cost and feasible benefit as well as throughput.

### Make OEE and health semantics explicit

OEE uses the fastest observed cycle despite configured ideal cycles in assets, and observed sample span stands in for planned production time. The dashboard averages station OEE into a plant headline. These choices need deliberate definitions and labels. Before adding measured rejects, revisit performance's use of good count: the current formula would penalize rejects in both performance and quality.

Use configured or approved product-specific ideal cycles, production calendars and good/reject signals. Keep assumed quality visibly distinct from measured quality. Define a line KPI separately from an average of station scores.

Health is a hand-written combination of availability, performance and stop count. RUL is then computed from an arbitrary 720-hour horizon and the squared score. It has no fitted failure-time model. Label this as a condition indicator; reserve maintenance-life predictions for a model with relevant labeled evidence. Planned waiting and downstream blocking should not automatically imply machine wear.

## Priority 3 — reliable data and service operation

| Area | Finding and improvement |
|---|---|
| Historian parity | Influx sorts within Flux tables, then concatenates them without a global sort. Event tables can be grouped by event type, breaking chronology expected by the engine. Add the same behavioral contract tests for both stores, including nullable fields, exact bounds, ordering, duplicates and resets. |
| Data provenance | Historian writers discard `source` and `spindle_rpm`. Raw telemetry has no source field, so physical retrofit output defaults to simulated. Separate transport protocol from simulated/demo/physical origin and persist both. Preserve provenance through calibration and reporting. |
| Identity | Several dictionaries and historian lookups use station ID alone. Two lines with an S1 would collide. Use `(plant, line, station)` or enforce globally unique asset IDs with validation. |
| Validation | Timestamps are strings; numeric fields lack domain bounds and finite-value guards; ingestion does not compare payload identity with topic identity. Use strict validated timestamps, finite numbers, appropriate ranges, and identity matching. |
| API boundaries | Invalid windows and zero replications produce 500 errors. Use bounded request schemas, discriminated what-if changes, station membership checks, finite values, and controlled 4xx responses. Cap expensive simulation work. |
| Ingestion durability | QoS 0, synchronous per-message DB writes, and no spool/replay leave gaps during outages. Introduce a bounded ingestion queue, batches, durable critical events, idempotent IDs and replay. QoS changes alone do not provide exactly-once processing. |
| Traceability | Part exits are held only in LiveHub's 12-item deque; ingestion does not persist them. IDs restart with each emulator session and lack line context in snapshots. Persist uniquely identified part histories before claiming historical traceability. |
| WebSocket reliability | The broadcast loop awaits KPI refresh before sending live data, and sends to clients sequentially without timeouts. Separate KPI refresh scheduling from fast broadcasts; use bounded per-client queues/timeouts. |
| Lifecycle | LiveHub has no shutdown cleanup for its MQTT loop or broadcast task. Fixed MQTT IDs also conflict across API workers. Manage clients/tasks through app lifespan and keep connector ownership explicit. |
| Cache | Global response caches and per-key locks have no eviction, cross app instances, and are not invalidated after calibration. Use bounded app-scoped caches with monotonic expiry and version-aware keys. |
| Observability | `/api/health` always returns OK with a backend name; several errors are swallowed. Add broker, ingestion, historian and connector readiness, source freshness, dropped-message counters, query latency and simulation duration. |
| Security | The viewer/engineer switch is only client state; backend endpoints have no authorization. Brokers allow anonymous access; dev broker binds all interfaces and Compose publishes ports. Establish local-only demo defaults, then server-side roles, authenticated transport, topic ACLs and resource limits before shared deployment. |
| Startup/stop | Launch scripts use fixed sleeps and announce success without readiness checks. Stop scripts kill broad patterns and all processes on ports 8020/5173. Use owned process identities, readiness checks, and a supervised service lifecycle. |
| Configuration | Python reads environment variables but does not load `.env` itself. Make configuration loading explicit and validate asset/scenario/mapping consistency at startup. Avoid automatic historian selection independently choosing different stores in different processes. |

## Frontend and visualization improvements

Keep the existing state colors plus labels, model fallbacks, asset registry and bounded display history. These are useful foundations.

1. Split the 2,972-line `Floor3D.tsx` into scene infrastructure, product models, warehouse geometry and telemetry bindings. Isolate illustrative animations from operational state. The 571-line `MachineModels.tsx` can use a registry of machine renderers.
2. Lazy-load 3D and optional pages. The build currently places roughly 1.85 MB of JavaScript in one main chunk. Preserve a fast dashboard/2D path, use selectable graphics quality, pause offscreen animations, and measure frame time before further tuning. Existing instancing and limited DPR are good starting points.
3. Make 2D and 3D consume the same layout. `FloorMap.tsx` currently draws a fixed horizontal line and fixed zones rather than the selected flow graph.
4. Replace broad `any` response types with shared/generated API contracts. Add request cancellation, stale-response guards, timeouts, loading/error states and a clear last-success timestamp. Fetch fallbacks currently turn failures into empty or zero-looking data; optimization can remain labeled “Searching…” after a failed request.
5. Draw timelines on a shared absolute time axis. Current rows stretch their own observed durations to full width, concealing differences in coverage and alignment.
6. Treat truck fill, pick slips, AGVs and carrier motion according to their actual data source. Some are random or clock-driven examples, not tracked entities. Truck completion continues from `Date.now()` independently of production. Put examples behind an explicit demonstration mode, or drive them from persisted operational events. Keep the existing “representative” pick-slip label and extend that clarity consistently.
7. The displayed engine supply connection is not a modeled material dependency: engine and vehicle emulators run independently. Add a real join/buffer constraint before predicting the effect of engine shortages on vehicle output.
8. Make clickable chips, station rows and SVG markers keyboard accessible; improve narrow-screen layouts and expose meaningful error/empty states. Add a browser smoke test for line switching, window switching, missing model fallback, disconnect/reconnect and what-if errors.

## Firmware and physical pilot

The firmware is an acquisition starting point, not yet a verified field device. IR edges are polled in the main loop, which blocks during current sampling and network reconnection. This can miss parts; it also has no debounce. The counter resets on reboot, timestamps are assigned on arrival, publish results are unchecked, and there is no local telemetry buffer.

Before the pilot, use interrupt/hardware-assisted counting where appropriate, explicit debounce, session IDs, time synchronization and buffered delivery. Measure sampling cadence and current calibration with the actual sensor setup. Test loss of Wi-Fi/broker, device restart, brief pulses and counter continuity on the bench. Define ground truth and capture it independently of the inferencer.

## Maintainability and project organization

Separate API routers from app construction; isolate ingestion, connectors and simulation workers from the web process. Keep pure domain functions for state segments, counters and fitted parameters. Retain a single authoritative schema; mark the incompatible `reference/` implementation clearly as reference material.

Add a reproducible dependency lock and a CI gate for Python tests, frontend type-check/build, local protocol integration, and benchmark label coverage. The Modbus mismatch demonstrates why pure mapping tests are insufficient. Add fixtures for reset counters, missing events, duplicate IDs across lines, out-of-order messages, retention boundaries and missing cycle data. These tests address observed defects rather than just mirroring implementation.

Update README status, stale “stub” descriptions, test counts, the inference method description, and emulator-versus-physical validation wording. Remove collision backup files from the active source tree after confirming they are unnecessary. Inventory shipped assets and retain the repository's source/credit metadata; binary models were not re-audited in this review.

The reference dataset calibration script explicitly notes arbitrary time units but outputs fields named `cycle_mean_s`. Do not feed those values into active simulation without documented unit conversion. Dwell time is also not automatically processing time.

## Recommended implementation sequence

| Stage | Work | Completion criterion |
|---|---|---|
| 1 — correct the existing product | Line/window context, connector events, configured topology, count resets, event timestamps, Modbus call, inference label coverage. | Regression fixtures pass and every visible KPI has matching scope and coverage. |
| 2 — trusted data foundation | Explicit clock mode, retention, historian parity, provenance, durable events, source freshness and API validation. | Replay one captured stream through both historian backends and obtain equivalent KPIs; recover correctly from outages. |
| 3 — trustworthy model | Active calibration versions, unique cycle samples, fit gates, warm-up/initial state, separate downtime, held-out validation. | Frozen model predicts an unseen period/change with documented uncertainty and provenance. |
| 4 — operator experience | Explicit data/error states, aligned timelines, common 2D/3D layout, lazy loading, accessible controls and demo labeling. | Browser workflows stay consistent across lines, windows, failures and lower-powered devices. |
| 5 — physical evidence | Bench-tested edge device, independently labeled machine data and before/after intervention study. | Reproducible real-cell report with acquisition quality, inference errors, prediction errors and experiment conditions. |

After those stages, the most valuable extensions are persisted scenario comparison, product/shift-aware OEE, durable part genealogy, cost-aware optimization, and operationally grounded alerts. The proposed retrofit → inference → calibrated simulation → verified intervention chain should remain the central project story. The current code review establishes implementation strengths and gaps; it does not establish novelty or patentability.
