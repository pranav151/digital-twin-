import type { StationLive, StationKpi } from "../types";
import { STATE_COLOR, STATE_ICON, STATE_LABEL, type MachineState } from "../types";

// bottleneck heat ramp: HIGH utilisation = hot = the constraint
function heat(u: number): string {
  return u >= 0.85 ? "#f85149" : u >= 0.6 ? "#db6d28" : u >= 0.35 ? "#d29922" : "#3fb950";
}

const W = 1040, H = 560;
const ZONES = [
  { x: 40, w: 250, label: "INTAKE / RAW" },
  { x: 300, w: 250, label: "MACHINING" },
  { x: 560, w: 240, label: "ASSEMBLY" },
  { x: 810, w: 190, label: "PACKAGING · SHIP" },
];

function Pin({ x, y, color, icon, selected }:
  { x: number; y: number; color: string; icon: string; selected: boolean }) {
  // teardrop map marker with a state glyph (redundant encoding — not colour alone)
  return (
    <g transform={`translate(${x},${y})`}>
      {selected && <circle cx={0} cy={0} r={26} fill="none" stroke="var(--brand)" strokeWidth={2} opacity={0.9} />}
      <path d="M0 6 C-14 -10 -12 -30 0 -34 C12 -30 14 -10 0 6 Z" fill={color} stroke="#0b1120" strokeWidth={2} />
      <circle cx={0} cy={-22} r={8} fill="#0b1120" opacity={0.9} />
      <text x={0} y={-18.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{icon}</text>
    </g>
  );
}

function Machine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 44},${y - 30})`}>
      <rect x={0} y={0} width={88} height={60} rx={7} fill="#1a2740" />
      <rect x={0} y={0} width={88} height={60} rx={7} fill="#20304f" stroke="#33456b" />
      <rect x={8} y={9} width={72} height={26} rx={4} fill="#2b3c60" />
      <rect x={8} y={40} width={30} height={12} rx={3} fill="#33456b" />
      <rect x={50} y={40} width={30} height={12} rx={3} fill="#33456b" />
      <circle cx={72} cy={15} r={3} fill="#4cc2ff" />
    </g>
  );
}

export function FloorMap({
  stations, selected, onSelect, bottleneck, kpi = {},
}: {
  stations: StationLive[];
  selected: string | null;
  onSelect: (s: string) => void;
  bottleneck?: string | null;
  kpi?: Record<string, StationKpi>;
}) {
  const n = stations.length || 4;
  const beltY = 330;
  const first = 190, last = 858;
  const step = n > 1 ? (last - first) / (n - 1) : 0;
  const xs = stations.map((_, i) => first + i * step);

  return (
    <svg className="floormap" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="factory operational floor map">
      <defs>
        <pattern id="floorgrid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" stroke="#152038" strokeWidth="1" />
        </pattern>
        <linearGradient id="belt" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2b3c60" />
        </linearGradient>
      </defs>

      {/* building + floor */}
      <rect x={20} y={20} width={W - 40} height={H - 40} rx={16} fill="#0e1730" stroke="#28344f" />
      <rect x={20} y={20} width={W - 40} height={H - 40} rx={16} fill="url(#floorgrid)" stroke="#28344f" />

      {/* zones */}
      {ZONES.map((z) => (
        <g key={z.label}>
          <rect x={z.x} y={70} width={z.w} height={H - 130} rx={12}
                fill="#12203a" stroke="#243b63" opacity={0.55} />
          <rect x={z.x} y={70} width={z.w} height={H - 130} rx={12} fill="none" stroke="#243b63" />
          <text x={z.x + 14} y={94} fill="#5f7099" fontSize={11} fontWeight={700} letterSpacing="0.6">{z.label}</text>
        </g>
      ))}

      {/* storage racks (packaging, top-right — clear of the line) */}
      {[0, 1].map((r) => (
        <g key={r} transform={`translate(852,${112 + r * 40})`}>
          {[0, 1, 2, 3].map((c) => (
            <rect key={c} x={c * 34} y={0} width={28} height={20} rx={3} fill="#1b2a49" stroke="#2c3f66" />
          ))}
        </g>
      ))}

      {/* conveyor belt */}
      <rect x={first - 60} y={beltY - 12} width={last - first + 120} height={24} rx={12}
            fill="#1c2947" stroke="#31456e" />
      <line x1={first - 60} y1={beltY} x2={last + 60} y2={beltY} stroke="#3a527f"
            strokeWidth={2} strokeDasharray="6 8" />
      <text x={40} y={beltY - 22} fill="#6b7ba1" fontSize={11}>material in →</text>
      <text x={W - 40} y={beltY - 22} fill="#6b7ba1" fontSize={11} textAnchor="end">→ finished out</text>

      {/* inter-station buffers */}
      {xs.slice(0, -1).map((x, i) => (
        <g key={i} transform={`translate(${(x + xs[i + 1]) / 2},${beltY})`}>
          <rect x={-9} y={-9} width={18} height={18} rx={3} fill="#16233f" stroke="#31456e" />
          <text x={0} y={26} textAnchor="middle" fill="#4a5a80" fontSize={9}>buffer</text>
        </g>
      ))}

      {/* machines + live pins */}
      {stations.map((s, i) => {
        const x = xs[i];
        const st = s.state as MachineState;
        const color = STATE_COLOR[st] || "#64748b";
        const isSel = selected === s.station_id;
        const isBot = !!bottleneck && bottleneck.split(",").includes(s.station_id);
        return (
          <g key={s.station_id} style={{ cursor: "pointer" }} onClick={() => onSelect(s.station_id)}>
            <Machine x={x} y={beltY} />
            {/* status ring on the machine */}
            <rect x={x - 47} y={beltY - 33} width={94} height={66} rx={9} fill="none"
                  stroke={isSel ? "var(--brand)" : color} strokeWidth={isSel ? 3 : 2}
                  opacity={isSel ? 1 : 0.9} />
            {/* label chip below, with a utilisation heat bar (bottleneck analyzer) */}
            <g transform={`translate(${x},${beltY + 52})`}>
              <rect x={-52} y={0} width={104} height={56} rx={8} fill="#0f1a30" stroke="#26314d" />
              <circle cx={-40} cy={13} r={4} fill={color} />
              <text x={-30} y={16} fill="var(--text)" fontSize={12} fontWeight={700}>{s.station_id}</text>
              <text x={44} y={16} textAnchor="end" fill={color} fontSize={10} fontWeight={700}>
                {STATE_LABEL[st] || s.state}
              </text>
              <text x={-40} y={31} fill="#7d8cad" fontSize={10}>
                {s.part_count} parts · {s.current_a != null ? s.current_a.toFixed(1) + "A" : "—"}
              </text>
              {(() => {
                const u = kpi[s.station_id]?.utilization;
                if (u == null) return null;
                return (<g transform="translate(0,40)">
                  <rect x={-40} y={0} width={80} height={5} rx={2.5} fill="#0c1426" />
                  <rect x={-40} y={0} width={80 * Math.min(1, u)} height={5} rx={2.5} fill={heat(u)} />
                  <text x={44} y={5} textAnchor="end" fill="#7d8cad" fontSize={9}>{Math.round(u * 100)}%</text>
                </g>);
              })()}
            </g>
            <Pin x={x} y={beltY - 40} color={color} icon={STATE_ICON[st] || "?"} selected={isSel} />
            {isBot && (
              <text x={x} y={beltY - 74} textAnchor="middle" fill="var(--idle)" fontSize={11} fontWeight={800}>
                ▲ BOTTLENECK
              </text>
            )}
          </g>
        );
      })}

      {!stations.length && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="#5f7099" fontSize={14}>waiting for live telemetry…</text>
      )}
    </svg>
  );
}
