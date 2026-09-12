import type { TimelineSeg } from "../types";
import { STATE_COLOR, STATE_LABEL, type MachineState } from "../types";

/** Per-machine machine-states timeline (green/amber/orange/red bars) — the
 *  FactoryTalk-style Gantt. */
export function StatesGantt({
  stationIds, timelines, selected, onSelect,
}: {
  stationIds: string[];
  timelines: Record<string, TimelineSeg[]>;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  return (
    <div>
      <div className="bars" style={{ gap: 8 }}>
        {stationIds.map((sid) => {
          const segs = timelines[sid] || [];
          const total = segs.reduce((a, s) => a + s.duration_s, 0) || 1;
          return (
            <div key={sid} style={{ display: "grid", gridTemplateColumns: "34px 1fr", alignItems: "center", gap: 10,
              cursor: "pointer", opacity: selected && selected !== sid ? 0.6 : 1 }}
              onClick={() => onSelect(sid)}>
              <span style={{ fontWeight: 700 }}>{sid}</span>
              <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden",
                border: "1px solid var(--border)", background: "var(--panel-2)" }}>
                {segs.map((s, i) => (
                  <div key={i} title={`${STATE_LABEL[s.state as MachineState]} · ${Math.round(s.duration_s)}s`}
                    style={{ width: `${(s.duration_s / total) * 100}%`, background: STATE_COLOR[s.state as MachineState] }} />
                ))}
                {!segs.length && <div className="dim" style={{ padding: "2px 8px", fontSize: 11 }}>no data</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend">
        {(Object.keys(STATE_COLOR) as MachineState[]).map((s) => (
          <span key={s}><i className="sw" style={{ background: STATE_COLOR[s] }} />{STATE_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}
