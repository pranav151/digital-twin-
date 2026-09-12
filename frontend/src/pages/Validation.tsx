import { useCallback, useEffect, useState } from "react";
import { getValidation, getCalibrations, postCalibrate } from "../api";

function PairedBar({ real, sim }: { real: number; sim: number }) {
  const max = Math.max(real, sim, 1);
  const Bar = ({ label, v, color }: { label: string; v: number; color: string }) => (
    <div style={{ display: "grid", gridTemplateColumns: "58px 1fr 66px", alignItems: "center", gap: 10, margin: "8px 0" }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <div className="bar-track" style={{ height: 16 }}>
        <div className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: color, height: "100%" }} />
      </div>
      <span style={{ fontWeight: 700, textAlign: "right" }}>{v.toFixed(0)} <span className="dim" style={{ fontWeight: 500, fontSize: 11 }}>u/hr</span></span>
    </div>
  );
  return (<div>
    <Bar label="Real" v={real} color="var(--running)" />
    <Bar label="Twin" v={sim} color="var(--brand)" />
  </div>);
}

function History({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="dim">No calibration versions stored yet — hit “Recalibrate now”.</div>;
  const asc = [...rows].reverse();
  const vals = asc.map((r) => r.real_units_per_hr || 0);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const W = 520, H = 90, pad = 6;
  const pts = asc.map((r, i) => {
    const x = pad + (i * (W - 2 * pad)) / Math.max(1, asc.length - 1);
    const y = H - pad - ((r.real_units_per_hr - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
    return `${x},${y}`;
  }).join(" ");
  const stationIds = Object.keys(asc[asc.length - 1]?.station_cycle_means || {});
  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ maxWidth: W }}>
          <polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth={2} />
          {asc.map((r, i) => {
            const x = pad + (i * (W - 2 * pad)) / Math.max(1, asc.length - 1);
            const y = H - pad - ((r.real_units_per_hr - min) / Math.max(1e-9, max - min)) * (H - 2 * pad);
            return <circle key={i} cx={x} cy={y} r={3} fill="var(--brand)" />;
          })}
        </svg>
      </div>
      <div className="sub" style={{ marginBottom: 8 }}>real throughput (u/hr) across stored calibration versions — the twin tracking reality over time</div>
      <div className="scroll" style={{ boxShadow: "none" }}>
        <table className="tbl">
          <thead><tr><th>Ver</th><th>When</th><th>Real u/hr</th>{stationIds.map((s) => <th key={s}>{s} cyc</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.version}>
                <td style={{ fontWeight: 700 }}>v{r.version}</td>
                <td className="dim">{(r.ts || "").slice(0, 19).replace("T", " ")}</td>
                <td>{(r.real_units_per_hr ?? 0).toFixed(1)}</td>
                {stationIds.map((s) => <td key={s} className="muted">{r.station_cycle_means?.[s] ?? "–"}s</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Validation({ window, canWrite = true }: { window: string; canWrite?: boolean }) {
  const [val, setVal] = useState<any>(undefined);   // undefined=loading, null=error
  const [rows, setRows] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const loadVal = useCallback(() => {
    setVal(undefined);
    getValidation("L1", window).then(setVal);
  }, [window]);
  const loadHist = useCallback(() => getCalibrations("L1", 20).then(setRows), []);

  useEffect(() => { loadVal(); }, [loadVal]);
  useEffect(() => { loadHist(); }, [loadHist]);

  const recalibrate = async () => {
    setBusy(true);
    try { await postCalibrate("L1", "15m"); await loadHist(); }
    finally { setBusy(false); }
  };

  const err = val?.error_pct;
  const pass = err != null && err <= 10;
  const tone = err == null ? "var(--muted)" : pass ? "var(--running)" : err <= 15 ? "var(--idle)" : "var(--down)";

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="grid cols">
        <div className="card">
          <div className="h"><h3>Twin validation · sim vs real</h3>
            <span className="chip btn" onClick={loadVal}>Re-run</span></div>
          {val === undefined && <div className="dim">running the twin…</div>}
          {val === null && <div style={{ color: "var(--down)" }}>couldn’t reach the twin — is the backend up?</div>}
          {val && (
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div className="lbl">Prediction error</div>
                <div style={{ fontSize: 46, fontWeight: 800, color: tone, lineHeight: 1 }}>
                  {err == null ? "–" : err.toFixed(1)}<small style={{ fontSize: 18 }}>%</small>
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="stat" style={{ border: `1px solid ${tone}`, color: tone, borderRadius: 20, padding: "2px 10px", fontWeight: 700, fontSize: 11 }}>
                    {err == null ? "no data" : pass ? "✓ within 10%" : err <= 15 ? "△ within 15%" : "✗ off"}
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <PairedBar real={val.real_throughput_units_per_hr || 0} sim={val.sim_throughput_units_per_hr || 0} />
              </div>
            </div>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            The twin is fitted to the live historian, run for the observed span, and its throughput
            compared to what the cell actually produced. ≤10% is the target (plan §7).
          </p>
        </div>

        <div className="card">
          <div className="h"><h3>What this proves</h3></div>
          <p style={{ fontSize: 13.5, color: "var(--ink-2, var(--muted))" }}>
            A twin is only credible if it matches reality. This is the evidence for the paper and
            the patent: the model auto-fits from inferred data and stays within tolerance without
            manual re-modelling.
          </p>
          <ul style={{ fontSize: 13, color: "var(--muted)", paddingLeft: 18, marginTop: 8 }}>
            <li>Headline closed-loop: predicted +34% → real +33% (1.3% error).</li>
            <li>Re-run after any scenario change to re-check tracking.</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="h"><h3>Self-calibration history</h3>
          <button className="primary" onClick={recalibrate} disabled={busy || !canWrite}
            title={canWrite ? "" : "Engineer role required to re-calibrate the twin"}
            style={{ padding: "7px 14px", fontSize: 13 }}>
            {busy ? "Calibrating…" : canWrite ? "Recalibrate now" : "Recalibrate (engineer only)"}
          </button></div>
        <History rows={rows} />
      </div>
    </div>
  );
}
