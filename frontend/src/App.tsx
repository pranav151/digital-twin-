import { useEffect, useState } from "react";
import { connectLive, getBottleneck, getLines } from "./api";
import type { Snapshot } from "./types";
import { SOURCE_BADGE } from "./types";
import { Overview } from "./pages/Overview";
import { WhatIf } from "./pages/WhatIf";
import { Validation } from "./pages/Validation";
import { Copilot } from "./pages/Copilot";
import { MachineRail } from "./components/MachineRail";
import "./styles.css";

const WINDOWS = ["15m", "1h", "8h"];

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "whatif" | "validation" | "copilot">("overview");
  const [win, setWin] = useState("1h");
  const [role, setRole] = useState<"viewer" | "engineer">("engineer");
  const [series, setSeries] = useState<{ t: string; v: number }[]>([]);
  const [bottleneck, setBottleneck] = useState<string | null>(null);
  const [line, setLine] = useState("BMW_X5");                 // default to the BMW plant showcase
  const [lineList, setLineList] = useState<{ id: string; name: string | null }[]>([]);

  useEffect(() => connectLive(setSnap, setConnected), []);
  useEffect(() => { getLines().then(setLineList); }, []);

  useEffect(() => {
    if (!snap?.kpi?.line) return;
    const t = new Date((snap.ts || Date.now() / 1000) * 1000).toLocaleTimeString().slice(0, 8);
    setSeries((prev) => [...prev, { t, v: snap.kpi.line.units_per_hr || 0 }].slice(-80));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.ts]);

  useEffect(() => {
    let alive = true;
    // badge the bottleneck of the selected line (or every real line when "ALL")
    const realLines = line === "ALL"
      ? lineList.filter((l) => l.id !== "ALL").map((l) => l.id)
      : [line];
    const load = () => Promise.all(realLines.map((l) => getBottleneck(l, win)))
      .then((res) => {
        if (!alive) return;
        const ids = res.map((b) => b?.bottleneck).filter(Boolean);
        setBottleneck(ids.length ? ids.join(",") : null);
      });
    load();
    const id = setInterval(load, 8000);
    return () => { alive = false; clearInterval(id); };
  }, [win, line, lineList]);

  const stationIds = (snap?.stations || []).map((s) => s.station_id);
  const toggle = (s: string) => setSelected((cur) => (cur === s ? null : s));

  return (
    <div className="shell">
      <div className="brand">
        <div className="logo">⚙️</div>
        <div><b>Factory Twin</b><small>Operational Overview</small></div>
      </div>

      <div className="topbar">
        <select className="chip lineselect" value={line} title="Switch plant / line"
                onChange={(e) => { setLine(e.target.value); setSelected(null); }}>
          {lineList.map((l) => (
            <option key={l.id} value={l.id}>🏭 {l.name || l.id}</option>
          ))}
        </select>
        {snap?.source && (() => {
          const b = SOURCE_BADGE[snap.source] ?? SOURCE_BADGE.simulated;
          return (
            <span className={"chip source-badge" + (b.real ? " real" : "")}
                  title={b.real
                    ? "Live data from real (or demo) hardware via a connector"
                    : "Synthetic data from the SimPy emulator — no hardware attached"}>
              <span className={"dot " + (b.real ? "live-on" : "live-sim")} /> {b.label}
            </span>
          );
        })()}
        <div className="seg" title="Time window — every panel respects this">
          {WINDOWS.map((w) => (
            <button key={w} className={win === w ? "active" : ""} onClick={() => setWin(w)}>{w}</button>
          ))}
        </div>
        <div className="seg">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button className={tab === "whatif" ? "active" : ""} onClick={() => setTab("whatif")}>What-If</button>
          <button className={tab === "validation" ? "active" : ""} onClick={() => setTab("validation")}>Validation</button>
          <button className={tab === "copilot" ? "active" : ""} onClick={() => setTab("copilot")}>Copilot</button>
        </div>
        <span className="spacer" />
        <div className="seg mini" title="Run-time role — a viewer can't change what the twin is calibrated to (ThingWorx-style split)">
          <button className={role === "viewer" ? "active" : ""} onClick={() => setRole("viewer")}>Viewer</button>
          <button className={role === "engineer" ? "active" : ""} onClick={() => setRole("engineer")}>Engineer</button>
        </div>
        <span className="chip"><span className={"dot " + (connected ? "live-on" : "live-off")} /> {connected ? "Live" : "Reconnecting…"}</span>
        <span className="chip btn" onClick={() => setSelected(null)}>Reset view</span>
      </div>

      <MachineRail snap={snap} line={line}
                   lineName={lineList.find((l) => l.id === line)?.name || line}
                   selected={selected} onSelect={toggle} />

      <main className="main">
        {tab === "overview" && (
          <Overview snap={snap} selected={selected} onSelect={toggle} series={series}
                    bottleneck={bottleneck} window={win} line={line} />
        )}
        {tab === "whatif" && <WhatIf stations={stationIds} window={win} />}
        {tab === "validation" && <Validation window={win} canWrite={role === "engineer"} />}
        {tab === "copilot" && <Copilot window={win} />}
      </main>
    </div>
  );
}
