import { useEffect, useState } from "react";
import { getHealth } from "../api";
import { RISK_COLOR, type Health, type HealthRow } from "../types";

/** Predictive-maintenance panel: per-machine condition score, failure risk and an
    estimated RUL, derived from the same inferred timeline/telemetry the twin uses
    (no dedicated condition sensor needed). Sorted worst-first. */
export function HealthPanel({ window: win, onSelect }: {
  window: string; onSelect?: (s: string) => void;
}) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => getHealth("L1", win).then((h) => alive && h && setHealth(h));
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [win]);

  const rows = health?.stations ?? [];
  const atRisk = rows.filter((r) => r.risk === "high" || r.risk === "critical").length;

  return (
    <div className="card">
      <div className="h">
        <h3>Machine health · predicted RUL</h3>
        <span className="sub">
          {rows.length ? `${atRisk} at risk · ${win} · RUL estimated` : "waiting for data…"}
        </span>
      </div>
      <div className="health-list">
        {rows.map((r) => <HealthItem key={r.station_id} r={r} onSelect={onSelect} />)}
        {!rows.length && <div className="dim" style={{ padding: 12 }}>no telemetry in window yet</div>}
      </div>
    </div>
  );
}

function HealthItem({ r, onSelect }: { r: HealthRow; onSelect?: (s: string) => void }) {
  const c = RISK_COLOR[r.risk];
  const rul = r.monitoring_only
    ? "live · monitor"
    : r.rul_days != null
      ? (r.rul_days >= 1 ? `${r.rul_days}d RUL` : `${r.rul_hours}h RUL`)
      : "–";
  return (
    <div className="health-row" onClick={() => onSelect?.(r.station_id)}>
      <div className="health-id">
        <b>{r.station_id}</b>
        <small>{r.name}</small>
      </div>
      <div className="health-bar" title={`health ${r.health}%`}>
        <div className="health-fill" style={{ width: `${r.health}%`, background: c }} />
      </div>
      <div className="health-score" style={{ color: c }}>{Math.round(r.health)}</div>
      <div className="health-rul">{rul}</div>
      <span className="health-pill" style={{ borderColor: c, color: c }}>{r.risk}</span>
      <div className="health-signal">{r.signal}</div>
    </div>
  );
}
