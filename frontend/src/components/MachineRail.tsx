import type { Snapshot } from "../types";
import { STATE_COLOR, STATE_LABEL, type MachineState } from "../types";
import { MiniDonut } from "./Donut";

export function MachineRail({
  snap, line = "ALL", lineName, selected, onSelect,
}: {
  snap: Snapshot | null;
  line?: string;
  lineName?: string | null;
  selected: string | null;
  onSelect: (s: string) => void;
}) {
  const all = snap?.stations || [];
  // scope the rail to the selected plant/line (the WS carries every line)
  const stations = line === "ALL" ? all : all.filter((s) => s.line_id === line);
  const kpi = snap?.kpi?.stations || {};
  return (
    <aside className="rail">
      <h4>{lineName || line} · {stations.length} stations</h4>
      {!stations.length && <div className="dim" style={{ padding: 10 }}>connecting…</div>}
      {stations.map((s) => {
        const st = s.state as MachineState;
        return (
          <div key={s.station_id}
               className={"mrow" + (selected === s.station_id ? " sel" : "")}
               onClick={() => onSelect(s.station_id)}>
            <MiniDonut value={kpi[s.station_id]?.oee ?? 0} />
            <div>
              <div className="mname">{s.station_id}</div>
              <div className="mstate">
                <span className="pin-dot" style={{ background: STATE_COLOR[st], display: "inline-block", marginRight: 6 }} />
                {STATE_LABEL[st] || s.state}
              </div>
            </div>
            <div className="mo">
              {s.part_count}
              <div className="dim" style={{ fontWeight: 500 }}>parts</div>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
