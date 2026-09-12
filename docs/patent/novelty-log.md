# Novelty Log — Real-Time Factory Digital Twin

> ⚠️ Not legal advice. This log captures *what we built and when*, so the college
> IP cell / TBI and a patent attorney can assess patentability after a formal
> prior-art search (Google Patents, Espacenet, InPASS). Start dates matter for
> first-public-disclosure — **file before publishing/exhibiting.** (Build plan §2, §10.)

Keep this file append-only. Every time a novelty-relevant method is implemented
or changed, add a **dated** entry with the exact method, not a vague summary.

---

## The three-part novelty thesis (from plan §2)

1. **Retrofit state inference** — machine state (running/idle/blocked/down) + true
   cycle time from clamp-on current + IR count only, on a legacy un-instrumented
   machine (no PLC, no vendor integration, no machine mod).
2. **Self-calibrating twin** — the discrete-event model continuously refits its own
   parameters (cycle-time distributions, downtime rates) from the live historian.
3. **Commodity-hardware what-if** — Tecnomatix-style predictive what-if on a
   low-cost sensor kit + open-source stack, deployable by SMEs.

**Candidate claim shape (for the IP cell to refine):** *"A system and method for
real-time digital-twin synchronization of an un-instrumented manufacturing machine,
comprising retrofit current/optical state inference, and a self-calibrating
discrete-event model that continuously refits process parameters from the inferred
data stream."*

---

## Prior-art search — TODO before filing (plan §10)
Search these terms; for each, note the closest hit and **the gap our combination fills**.
- [ ] "retrofit digital twin"
- [ ] "self-calibrating discrete event twin"
- [ ] "current-based machine state inference"
- [ ] "low-cost OEE IoT"
- [ ] "non-invasive machine monitoring current clamp"

---

## Dated build log

### 2026-09-02 — Phase 0/1: data contract + emulator (foundation)
- **Fixed the message/topic contract** (`services/common`): MQTT topics
  `factory/{line}/{station}/{telemetry,event}` and pydantic payloads (plan §6.1).
  This is the decoupling seam that lets retrofit hardware (Phase 8) drop in behind
  the *same* interface the emulator uses — relevant to the "no machine modification /
  vendor-agnostic" framing of novelty #1.
- **Built the hardware-free cell emulator** (`edge/emulator/emulator.py`): serial
  line of N stations with finite buffers, normal-distributed cycle times, blocking/
  starving dynamics, and exponential-MTBF breakdowns with sampled MTTR.
- **Emulator emits a realistic per-state CURRENT signature** (running ≈ load current,
  idle/blocked ≈ standby, down ≈ 0, with gaussian noise). *This is deliberate:* it is
  the synthetic raw signal that the Phase-8 **state-inference** method (novelty #1)
  will be developed and unit-tested against before real CT-clamp data exists. When we
  implement inference, record here the exact current bands, thresholds/model, and the
  running→idle transition logic used to count cycles.
- Verified: three scenarios (`normal`, `bottleneck`, `breakdown`) produce distinct,
  believable streams; end-to-end MQTT publish→broker→subscribe roundtrip confirmed.

### 2026-09-03 — Phase 3/4: KPI engine + twin fitted from the historian (novelty #2 groundwork)
- **OEE/KPI engine** (`backend/app/kpi/`): OEE exactly per §6.4; per-station state
  durations reconstructed **exactly from the event stream** (each event carries the
  duration of the state it ended). Endpoints: stations, oee, throughput, timeline.
- **Self-calibration groundwork (novelty #2):** `backend/app/twin/calibration.py`
  fits each station's cycle-time distribution with **scipy (`stats.norm.fit`)** and
  estimates MTBF/MTTR from the reconstructed timeline — i.e. the model's parameters
  are **derived from the live historian, not hand-tuned**. `model.py` is a SimPy
  discrete-event twin (stations=processes, buffers=Stores; blocking/starving emerge).
- **Closed-loop validation evidence** (the defensible "twin tracks reality" claim):
  twin throughput vs emulator actual — **normal 0.47% error, bottleneck 0.42% error**
  (both ≤10% DoD). Twin recovers the bottleneck (S3 ~98% utilization). Full numbers:
  `docs/validation/phase4-validation.md`, dated 2026-09-03.
- Phase 5 turns this one-shot fit into a **continuous re-fit loop** (versioned parameter
  sets over time) + what-if — that is the headline novelty #2/#3 evidence; log it then.

### 2026-09-03 — Phase 5: self-calibration loop + what-if + closed-loop proof (novelty #2 & #3)
- **Self-calibration loop (novelty #2):** `backend/app/twin/calibration_store.py` +
  `scripts/calibration_loop.py` periodically re-fit the twin from the latest historian
  window and store **versioned** parameter sets (sqlite `calibrations` table). Demonstrated
  the twin auto-tracking a drift: stored versions show S3 cycle **55.2s → 41.3s** (real
  throughput 61→83/hr) with no manual re-model. This *continuous refit from the inferred
  data stream* is the defensible novelty-#2 claim; the versioned history is the evidence.
- **What-if engine (novelty #3):** `backend/app/twin/whatif.py` clones the calibrated
  model, applies changes (`cycle_reduction`, `add_operator`, `set_cycle`, `buffer_size`),
  runs M replications with common random numbers, returns predicted vs baseline KPIs +
  moved bottleneck. Endpoint `POST /api/simulate/whatif`. Auto **bottleneck detection**
  (`GET /api/analyze/bottleneck`) = highest-utilization station from the twin.
- **CLOSED-LOOP VALIDATION (the core evidence):** predicted the effect of speeding up
  the bottleneck 25% BEFORE applying it — **twin +34.3%, real cell +32.6%, error 1.26%**.
  Method + numbers: `docs/validation/phase5-closedloop.md`, dated 2026-09-03. Re-run the
  same closed loop on **real hardware** in Phase 8 for the filing.
- Note: all validation so far is on emulator data (a faithful stand-in). Real-cell numbers
  come in Phase 8; the *method* is what the claims rest on and is now implemented + proven.

### 2026-09-03 — Phase 8: retrofit current→state inference (NOVELTY #1, method of record)
Implemented in `services/inference/inference.py`. On a legacy un-instrumented machine,
using ONLY a clamp-on CT (current) + an IR part counter — no PLC, no vendor integration,
no machine modification — infer state (running/idle/blocked/down) + true cycle time:

1. **Self-calibrating current bands (no manual setup).** A rolling window of recent
   current samples is split by **1-D 2-means** into a not-running and a running cluster;
   `run_a` = midpoint of the two centers; `down_a` = a capped fraction of the low cluster.
   2-means (not percentiles) is used because it is robust to class imbalance — a machine
   that runs 90% of the time doesn't drag the threshold up into the running band. The
   bands adapt continuously, so the method tracks drift and differs per machine.
2. **Classification (EMA-smoothed current + IR), per sample:** current>run_a → running;
   current<down_a → down; else IR part-present → blocked, else idle. A minimum-dwell (2
   consecutive samples) debounce prevents state chatter.
3. **Cycle time = accrued RUNNING time per part** (reset on each IR increment), NOT wall
   time between completions — so a blocked station is not mistaken for a slow one. This is
   what feeds the self-calibrating twin (novelty #2).

**Validated against labeled traces** (emulator emits both raw signal AND true state):
state-inference accuracy **normal 99.5%, bottleneck 96.1%, breakdown 96.1%** (`down` is the
hardest at ~85% recall — its current band overlaps idle/blocked; documented classifier-
upgrade path per plan §12). **Cycle-time inference error 1.5–2.0%** across scenarios.
**Full Route-B closed loop** (raw current+IR → inference → historian → twin) recovered the
bottleneck (S3) and validated twin throughput on INFERRED data at **0.89% error**. Numbers:
`docs/validation/phase8-inference.md`. ESP32 firmware: `edge/firmware/`; Route A (PLC via
Node-RED): `edge/node-red/flow.json`.

> Re-run this eval on the REAL cell in Phase 9 (label a short window by hand / by video)
> to produce the on-hardware accuracy number for the filing.

---

## Evidence to capture as we go (plan §10)
- [ ] Exact state-inference method (currents, thresholds/model, transition logic) — dated
- [ ] Exact calibration method (what refits, from what window, how often) — dated
- [ ] What-if closed-loop validation results (predicted Δ vs real Δ, error %)
- [ ] Block diagrams + data flow (reuse plan §3 / `docs/architecture.md`)
- [ ] Inventor list + contributions (ME + AS + IM — see plan §11)
- [ ] First public-disclosure date awareness — coordinate filing vs paper/exhibition
