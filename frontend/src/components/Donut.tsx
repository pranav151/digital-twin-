export function Donut({
  value, label, size = 120, thickness = 12, color,
}: {
  value: number; label?: string; size?: number; thickness?: number; color?: string;
}) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const col = color || (pct >= 0.85 ? "var(--running)" : pct >= 0.6 ? "var(--idle)" : "var(--down)");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={thickness} />
      <circle
        cx={cx} cy={cx} r={r} fill="none" stroke={col} strokeWidth={thickness} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text x={cx} y={cx - 2} textAnchor="middle" fontSize={size * 0.26} fontWeight="750" fill="var(--text)">
        {Math.round(pct * 100)}
      </text>
      <text x={cx} y={cx + size * 0.15} textAnchor="middle" fontSize={size * 0.1} fill="var(--muted)">
        {label || "%"}
      </text>
    </svg>
  );
}

export function MiniDonut({ value, size = 34 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const th = 5, r = (size - th) / 2, c = 2 * Math.PI * r, cx = size / 2;
  const col = pct >= 0.85 ? "var(--running)" : pct >= 0.6 ? "var(--idle)" : "var(--down)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={th} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={col} strokeWidth={th} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 3} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)">
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}
