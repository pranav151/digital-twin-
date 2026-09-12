import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type { StationKpi } from "../types";

const tooltipStyle = {
  background: "#141c30", border: "1px solid #26314d", borderRadius: 10,
  color: "#eaf0fa", fontSize: 12,
};

export function ThroughputChart({ data }: { data: { t: string; v: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id="tp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4cc2ff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#4cc2ff" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1e2740" strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={{ fill: "#62718f", fontSize: 10 }} minTickGap={44} tickLine={false} axisLine={{ stroke: "#26314d" }} />
        <YAxis tick={{ fill: "#62718f", fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "#4cc2ff", strokeDasharray: "3 3" }} />
        <Area type="monotone" dataKey="v" name="units/hr" stroke="#4cc2ff" strokeWidth={2}
              fill="url(#tp)" isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function UtilizationBars({
  kpi, selected, onSelect,
}: {
  kpi: Record<string, StationKpi>;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  const ids = Object.keys(kpi).sort();
  if (!ids.length) return <div className="dim">waiting for data…</div>;
  return (
    <div className="bars">
      {ids.map((id) => {
        const u = kpi[id].utilization ?? 0;
        const col = u >= 0.85 ? "var(--running)" : u >= 0.5 ? "var(--idle)" : "var(--down)";
        return (
          <div className="bar-row" key={id} style={{ opacity: selected && selected !== id ? 0.6 : 1 }}
               onClick={() => onSelect(id)}>
            <span style={{ fontWeight: 700 }}>{id}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${u * 100}%`, background: col }} /></div>
            <span className="muted" style={{ textAlign: "right" }}>{(u * 100).toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}
