import { useState } from "react";
import { postWhatIf, getOptimize, type WhatIfChange } from "../api";

interface Scenario {
  id: number; label: string; baseline: number; predicted: number;
  delta_pct: number; bottleneck_after: string;
}

export function WhatIf({ stations, window: win }: { stations: string[]; window: string }) {
  const sList = stations.length ? stations : ["S1", "S2", "S3", "S4"];
  const [station, setStation] = useState(sList[0]);
  const [kind, setKind] = useState<"cycle_reduction" | "add_operator" | "buffer_size">("cycle_reduction");
  const [percent, setPercent] = useState(25);
  const [bufval, setBufval] = useState(5);
  const [reps, setReps] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [opt, setOpt] = useState<any>(undefined);   // undefined=idle, null=loading

  const buildChange = (): { change: WhatIfChange; label: string } => {
    if (kind === "cycle_reduction") return { change: { type: "cycle_reduction", station, percent }, label: `${station} −${percent}%` };
    if (kind === "add_operator") return { change: { type: "add_operator", station, operators: 1 }, label: `${station} +1 operator` };
    return { change: { type: "buffer_size", value: bufval }, label: `buffers → ${bufval}` };
  };

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const { change, label } = buildChange();
      const r = await postWhatIf({ line: "L1", window: win, changes: [change], replications: reps });
      setScenarios((prev) => [{
        id: Date.now(), label,
        baseline: r.baseline.units_per_hr, predicted: r.predicted.units_per_hr,
        delta_pct: r.delta_pct, bottleneck_after: r.predicted.bottleneck.bottleneck,
      }, ...prev].slice(0, 8));
    } catch (e: any) { setErr(e.message || "failed"); }
    finally { setBusy(false); }
  };

  const optimize = async () => {
    setOpt(null);
    setOpt(await getOptimize("L1", win));
  };

  const applyRec = (rec: any) => {
    const c = rec.change;
    if (c.type === "cycle_reduction") { setKind("cycle_reduction"); setStation(c.station); setPercent(c.percent); }
    else if (c.type === "add_operator") { setKind("add_operator"); setStation(c.station); }
    else { setKind("buffer_size"); setBufval(c.value); }
  };

  const maxPred = Math.max(1, ...scenarios.map((s) => Math.max(s.predicted, s.baseline)));

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid cols">
        {/* builder */}
        <div className="card">
          <div className="h"><h3>Experiment · test a change virtually</h3></div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Station</label>
              <select value={station} onChange={(e) => setStation(e.target.value)} disabled={kind === "buffer_size"}>
                {sList.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div><label>Change</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
                <option value="cycle_reduction">Reduce cycle time %</option>
                <option value="add_operator">Add an operator</option>
                <option value="buffer_size">Resize buffers (line-wide)</option>
              </select>
            </div>
            {kind === "cycle_reduction" && (
              <div><label>Reduction %</label>
                <input type="number" min={1} max={90} value={percent} onChange={(e) => setPercent(Number(e.target.value))} /></div>
            )}
            {kind === "buffer_size" && (
              <div><label>Buffer capacity</label>
                <input type="number" min={1} max={30} value={bufval} onChange={(e) => setBufval(Number(e.target.value))} /></div>
            )}
            <div><label>Replications</label>
              <input type="number" min={2} max={30} value={reps} onChange={(e) => setReps(Number(e.target.value))} /></div>
          </div>
          <button className="primary" style={{ marginTop: 16 }} onClick={run} disabled={busy}>
            {busy ? "Simulating…" : "Run & save scenario"}
          </button>
          {err && <div style={{ color: "var(--down)", marginTop: 10 }}>{err}</div>}
          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            Clones the calibrated twin (window {win}), applies the change, runs {reps} replications with
            common random numbers, and predicts the new throughput — before you touch the real line.
          </p>
        </div>

        {/* optimizer — the edge */}
        <div className="card" style={{ borderTop: "3px solid var(--brand)" }}>
          <div className="h"><h3>Recommended action <span className="stat s-part" style={{ border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 20, padding: "0 8px", fontSize: 9 }}>auto-optimiser</span></h3>
            <span className="chip btn" onClick={optimize}>{opt === null ? "Searching…" : "Find best"}</span></div>
          {opt === undefined && <div className="dim">Search the change space for the highest-impact move.</div>}
          {opt === null && <div className="dim">running ~12 simulations…</div>}
          {opt && opt.recommended && (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 4px" }}>{opt.recommended.label}</div>
              <div className="kpi-line">
                <span className="val" style={{ fontSize: 26 }}>{opt.recommended.predicted.toFixed(0)}<small> u/hr</small></span>
                <span className="delta-pos" style={{ fontSize: 18, fontWeight: 800, marginLeft: 10 }}>▲ {opt.recommended.delta_pct.toFixed(1)}%</span>
                <span className="muted" style={{ marginLeft: 8 }}>vs {opt.baseline_units_per_hr.toFixed(0)} baseline</span>
              </div>
              <div style={{ marginTop: 12 }}>
                {opt.candidates.slice(0, 5).map((c: any, i: number) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 70px", gap: 8, alignItems: "center", padding: "5px 0", borderTop: i ? "1px solid var(--border-soft)" : "none", fontSize: 13 }}>
                    <span onClick={() => applyRec(c)} style={{ cursor: "pointer" }} title="load into the builder">{c.label}</span>
                    <span className="muted" style={{ textAlign: "right" }}>{c.predicted.toFixed(0)}</span>
                    <span style={{ textAlign: "right", fontWeight: 700, color: c.delta_pct > 0.5 ? "var(--running)" : "var(--muted)" }}>{c.delta_pct >= 0 ? "+" : ""}{c.delta_pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* saved scenarios comparison */}
      <div className="card">
        <div className="h"><h3>Saved scenarios</h3>
          {scenarios.length > 0 && <span className="chip btn" onClick={() => setScenarios([])}>Clear</span>}</div>
        {!scenarios.length ? <div className="dim">run a scenario to compare — each saved run is added here.</div> : (
          <div className="bars">
            {scenarios.map((s) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "150px 1fr 120px", alignItems: "center", gap: 12 }}>
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                <div className="bar-track" style={{ height: 14 }}>
                  <div className="bar-fill" style={{ width: `${(s.predicted / maxPred) * 100}%`, background: s.delta_pct >= 0 ? "var(--running)" : "var(--down)", height: "100%" }} />
                </div>
                <span style={{ textAlign: "right" }}>
                  <b>{s.predicted.toFixed(0)}</b> <span className="dim">u/hr</span>
                  <span style={{ color: s.delta_pct >= 0 ? "var(--running)" : "var(--down)", fontWeight: 700, marginLeft: 6 }}>
                    {s.delta_pct >= 0 ? "▲" : "▼"}{Math.abs(s.delta_pct).toFixed(0)}%
                  </span>
                </span>
              </div>
            ))}
            <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>baseline ≈ {scenarios[0].baseline.toFixed(0)} u/hr · bars scaled to the best predicted</div>
          </div>
        )}
      </div>
    </div>
  );
}
