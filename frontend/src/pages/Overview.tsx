import { useEffect, useState } from "react";
import type { Snapshot, TimelineSeg, Asset, Layout } from "../types";
import { STATE_COLOR, type MachineState } from "../types";

const EMPTY_LAYOUT: Layout = { line_id: "L1", line_name: null, product: null, stations: [], flow: [], zones: [] };
import { getTimeline, getAssets, getOee, getLosses, getThroughput } from "../api";
import { FloorMap } from "../components/FloorMap";
import { Floor3D } from "../components/Floor3D";
import { StatesGantt } from "../components/StatesGantt";
import { ThroughputChart, UtilizationBars } from "../components/charts";
import { Donut } from "../components/Donut";
import { StatusPill } from "../components/StatusPill";
import { HealthPanel } from "../components/HealthPanel";

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
const pct = (x: number) => (x * 100).toFixed(0);

export function Overview({
  snap, selected, onSelect, series, bottleneck, window: win, line,
}: {
  snap: Snapshot | null;
  selected: string | null;
  onSelect: (s: string) => void;
  series: { t: string; v: number }[];
  bottleneck: string | null;
  window: string;
  line: string;
}) {
  const [timelines, setTimelines] = useState<Record<string, TimelineSeg[]>>({});
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const assets: Asset[] = layout.stations;
  const [selOee, setSelOee] = useState<any>(null);
  const [losses, setLosses] = useState<any>(null);
  const [thruLine, setThruLine] = useState<any>(null);
  const [engSupply, setEngSupply] = useState<any>(null);   // S58 engine-line output feeding the X5 marriage
  const [view, setView] = useState<"2d" | "3d">("3d");
  const kpi = snap?.kpi?.stations || {};

  // The WS snapshot carries EVERY plant's stations; scope the live set to the
  // selected line so the floor, rail and tables show just this line ("ALL" =
  // whole plant). Filter by the line_id tagged on each station server-side.
  const lineStations = line === "ALL"
    ? (snap?.stations || [])
    : (snap?.stations || []).filter((s) => s.line_id === line);
  const lineIdSet = new Set(lineStations.map((s) => s.station_id));

  // fetch the SELECTED line's layout (positions / flow / zones / product) for the floor
  useEffect(() => { getAssets(line).then(setLayout); }, [line]);
  const visibleIds = layout.stations.map((s) => s.id);

  // a specific line's own throughput; "ALL" uses the plant-wide sum from the WS
  useEffect(() => {
    if (line === "ALL") { setThruLine(null); return; }
    let alive = true;
    const load = () => getThroughput(line, win).then((t) => alive && setThruLine(t));
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [line, win]);

  // DATA LINK: on the vehicle line, poll the S58 engine line's live throughput so
  // the powertrain-marriage station can show its real supply (engine EOL -> X5).
  useEffect(() => {
    if (line !== "BMW_X5") { setEngSupply(null); return; }
    let alive = true;
    const load = () => getThroughput("BMW_ENGINE", win).then((t) => alive && setEngSupply(t)).catch(() => {});
    load();
    const iv = setInterval(load, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [line, win]);

  useEffect(() => {
    if (!visibleIds.length) return;
    let alive = true;
    const load = async () => {
      const out: Record<string, TimelineSeg[]> = {};
      await Promise.all(visibleIds.map(async (id) => { out[id] = await getTimeline(id, win); }));
      if (alive) setTimelines(out);
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds.join(","), win]);

  useEffect(() => {
    if (!selected) { setSelOee(null); return; }
    let alive = true;
    getOee(selected, win).then((o) => alive && setSelOee(o));
    return () => { alive = false; };
  }, [selected, win]);

  useEffect(() => {
    let alive = true;
    const load = () => getLosses(line, win).then((l) => alive && setLosses(l));
    load();
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [win, line]);

  // Line-level KPIs average only stations on the production FLOW — independent
  // real cells (e.g. a live MTConnect machine off the line) are shown per-machine
  // but must not drag the line OEE/availability.
  const flowIds = new Set(layout.flow.flat());
  const ks = Object.entries(kpi)
    .filter(([id]) => flowIds.size === 0 || flowIds.has(id))
    .map(([, k]) => k);
  const oee = mean(ks.map((k) => k.oee));
  const avail = mean(ks.map((k) => k.availability));
  const perf = mean(ks.map((k) => k.performance));
  const qual = mean(ks.map((k) => k.quality));
  const thru = line === "ALL" ? snap?.kpi?.line : thruLine;
  const countMap: Record<string, number> = {};
  lineStations.forEach((s) => { countMap[s.station_id] = s.part_count; });
  const wip = layout.flow.reduce((a, [f, t]) => a + Math.max(0, (countMap[f] ?? 0) - (countMap[t] ?? 0)), 0);
  // stoppages scoped to this line (issues don't carry a line, so match by station)
  const lineIssues = line === "ALL"
    ? (snap?.issues || [])
    : (snap?.issues || []).filter((i) => lineIdSet.has(i.station_id));
  const alerts = lineIssues.filter((i) => i.event_type === "down").length;
  const warns = lineIssues.filter((i) => i.event_type === "blocked").length;

  const sel = selected ? snap?.stations.find((s) => s.station_id === selected) : undefined;
  const selK = selected ? kpi[selected] : undefined;
  const selAsset = selected ? assets.find((a) => a.id === selected) : undefined;
  const assetMap: Record<string, Asset> = Object.fromEntries(assets.map((a) => [a.id, a]));

  const isWh = layout.product === "warehouse";
  if (!snap) return <div className="card"><div className="dim">connecting to live feed…</div></div>;

  return (
    <div className="grid" style={{ gap: 14 }}>
      {/* KPI tiles */}
      <div className={"grid kpis" + (isWh ? " wh" : "")}>
        <div className="card tile center">
          <div className="lbl">{isWh ? "Fulfilment" : "OEE · plant"}</div>
          <Donut value={oee} label={isWh ? "FILL" : "OEE"} size={104} />
        </div>
        <Tile label={isWh ? "Pick availability" : "Availability"} val={pct(avail)} unit="%" foot={isWh ? "pickers up" : "run / planned"} />
        <Tile label={isWh ? "Pick rate" : "Performance"} val={pct(perf)} unit="%" foot={isWh ? "vs standard" : "ideal / actual"} />
        <div className="card tile">
          <div className="lbl">{isWh ? "Pick accuracy" : "Quality"} <span title="No reject sensor on a retrofit cell — assumed, not measured"
            className="stat s-part" style={{ border: "1px solid var(--idle)", color: "var(--idle)", borderRadius: 20, padding: "0 7px", fontSize: 9, marginLeft: 4 }}>assumed</span></div>
          <div className="val">{pct(qual)}<small> %</small></div>
          <div className="foot">{isWh ? "good picks" : "good / total"}</div>
        </div>
        <Tile label={isWh ? "Boxes / hr" : "Throughput"} val={thru ? thru.units_per_hr.toFixed(0) : "–"} unit={isWh ? "box/hr" : "u/hr"}
              foot={isWh ? "shipped @ dock" : (thru?.terminal_station?.includes("+") ? `plant · ${thru.terminal_station}` : `terminal ${thru?.terminal_station ?? "–"}`)} />
        <div className="card tile">
          <div className="lbl">Issues</div>
          <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
            <div><div className="val" style={{ color: "var(--down)" }}>{alerts}</div><div className="foot">alerts</div></div>
            <div><div className="val" style={{ color: "var(--blocked)" }}>{warns}</div><div className="foot">warnings</div></div>
          </div>
          <div className="foot" style={{ marginTop: 4 }}>bottleneck <b style={{ color: "var(--idle)" }}>{bottleneck ?? "–"}</b></div>
        </div>
        {isWh && <TruckKpiTile />}
      </div>

      {/* floor map */}
      <div className="card">
        <div className="h">
          <h3>Operational overview · live floor</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="sub">click a machine to inspect · {lineStations.length} stations</span>
            <div className="seg mini">
              <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}>2D</button>
              <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>3D</button>
            </div>
          </div>
        </div>
        {view === "3d"
          ? <Floor3D stations={lineStations} selected={selected} onSelect={onSelect} bottleneck={bottleneck} kpi={kpi} layout={layout} flowRate={thru?.units_per_hr || 0} product={layout.product} engineSupply={engSupply} />
          : <FloorMap stations={lineStations} selected={selected} onSelect={onSelect} bottleneck={bottleneck} kpi={kpi} />}
        <div className="legend" style={{ marginTop: 8 }}>
          <span className="dim" style={{ fontWeight: 600 }}>utilisation heat:</span>
          <span><i className="sw" style={{ background: "#3fb950" }} />low</span>
          <span><i className="sw" style={{ background: "#d29922" }} />mid</span>
          <span><i className="sw" style={{ background: "#db6d28" }} />high</span>
          <span><i className="sw" style={{ background: "#f85149" }} />bottleneck</span>
        </div>
      </div>

      {/* warehouse: live pick slips (representative) */}
      {isWh && <WarehousePickSlips active={lineStations.filter((s) => s.state === "running").length} />}

      {/* predictive maintenance (not shown for the warehouse) */}
      {!isWh && <HealthPanel window={win} onSelect={onSelect} />}

      {/* analytics */}
      <div className="grid cols">
        <div className="grid" style={{ gap: 14 }}>
          <div className="card">
            <div className="h"><h3>Machine-state timeline</h3><span className="sub">last {win} · per station</span></div>
            <StatesGantt stationIds={visibleIds} timelines={timelines} selected={selected} onSelect={onSelect} />
          </div>
          <div className="card">
            <div className="h"><h3>Throughput · live</h3><span className="sub">units / hr</span></div>
            <ThroughputChart data={series} />
          </div>
        </div>
        <div className="grid" style={{ gap: 14 }}>
          <div className="card">
            <div className="h"><h3>Per-station utilization</h3></div>
            <UtilizationBars kpi={kpi} selected={selected} onSelect={onSelect} />
          </div>
          <div className="card">
            <div className="h"><h3>Recent stoppages</h3><span className="sub">{lineIssues.length} events</span></div>
            <table className="tbl">
              <thead><tr><th>Sev</th><th>Station</th><th>Reason</th><th style={{ textAlign: "right" }}>Time</th></tr></thead>
              <tbody>
                {lineIssues.slice(0, 8).map((it, i) => (
                  <tr key={i}>
                    <td><span className="badge" style={{ background: it.event_type === "down" ? "var(--down)" : "var(--blocked)", color: "#fff" }}>{it.event_type}</span></td>
                    <td style={{ fontWeight: 700 }}>{it.station_id}</td>
                    <td className="muted">{it.reason}</td>
                    <td className="dim" style={{ textAlign: "right" }}>{(it.ts || "").slice(11, 19)}</td>
                  </tr>
                ))}
                {!lineIssues.length && <tr><td colSpan={4} className="dim">no recent stoppages ✓</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* time lost by cause + production & waste (B2) */}
      <div className="grid cols">
        <div className="card">
          <div className="h"><h3>Time lost by cause</h3>
            <span className="sub">last {win} · {losses ? Math.round(losses.total_lost_s / 60) : 0} min total</span></div>
          {!losses || !losses.by_cause?.length ? (
            <div className="dim">no losses in window ✓</div>
          ) : (
            <div className="bars">
              {losses.by_cause.slice(0, 6).map((c: any, i: number) => {
                const max = losses.by_cause[0].seconds || 1;
                const col = STATE_COLOR[c.state as MachineState] || "var(--muted)";
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 78px", alignItems: "center", gap: 10 }}>
                    <span><StatusPill state={c.state as MachineState} size="sm" /> <span className="dim" style={{ fontSize: 11 }}>{c.reason}</span></span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.seconds / max) * 100}%`, background: col }} /></div>
                    <span className="muted" style={{ textAlign: "right", fontSize: 12 }}>{Math.round(c.seconds / 60)}m · {c.count}×</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card">
          <div className="h"><h3>Production &amp; waste</h3><span className="sub">this window</span></div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <div><div className="lbl">Good produced</div><div className="val" style={{ fontSize: 30 }}>{losses?.good_count ?? "–"}</div><div className="foot">units, terminal station</div></div>
            <div><div className="lbl">WIP (in transit)</div><div className="val" style={{ fontSize: 30 }}>{wip}</div><div className="foot">parts between stations</div></div>
            <div><div className="lbl">Scrap / waste</div><div className="val" style={{ fontSize: 30, color: "var(--muted)" }}>—</div>
              <div className="foot">no reject sensor <span className="stat s-part" style={{ border: "1px solid var(--idle)", color: "var(--idle)", borderRadius: 20, padding: "0 7px", fontSize: 9 }}>assumed 0</span></div></div>
          </div>
        </div>
      </div>

      {/* per-part traceability (spec §6.C) */}
      <div className="card">
        <div className="h"><h3>Finished parts · traceability</h3>
          <span className="sub">{(snap.parts || []).length ? `last ${(snap.parts || []).length} · WIP ${wip} on line` : "waiting for completions…"}</span></div>
        {!(snap.parts || []).length ? (
          <div className="dim">no parts have exited the line yet</div>
        ) : (
          <div className="scroll" style={{ boxShadow: "none", border: "none" }}>
            <table className="tbl">
              <thead><tr><th>Part ID</th><th>Lead time (on line)</th><th style={{ textAlign: "right" }}>Exited</th></tr></thead>
              <tbody>
                {(snap.parts || []).slice(0, 8).map((p) => (
                  <tr key={p.part_id}>
                    <td style={{ fontWeight: 700 }}>{p.part_id}</td>
                    <td className="muted">{p.lead_time_s != null ? `${Math.round(p.lead_time_s)} s` : "—"}</td>
                    <td className="dim" style={{ textAlign: "right" }}>{(p.ts || "").slice(11, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* equipment & maintenance (asset registry) */}
      <div className="card">
        <div className="h"><h3>Equipment &amp; maintenance</h3><span className="sub">{assets.length} assets · {layout.line_name || layout.line_id}</span></div>
        <div className="scroll" style={{ boxShadow: "none", border: "none" }}>
          <table className="tbl">
            <thead><tr><th>Station</th><th>Type</th><th>State</th><th>Parts</th><th>Ideal cyc</th><th>Next maintenance</th><th>Service provider</th></tr></thead>
            <tbody>
              {lineStations.map((s) => {
                const a = assetMap[s.station_id];
                return (
                  <tr key={s.station_id} style={{ cursor: "pointer" }} onClick={() => onSelect(s.station_id)}>
                    <td><b>{s.station_id}</b> <span className="muted">{a?.name ?? ""}</span></td>
                    <td className="muted">{a?.type ?? "—"}</td>
                    <td><StatusPill state={s.state} size="sm" /></td>
                    <td>{s.part_count}</td>
                    <td className="muted">{a?.ideal_cycle_s != null ? a.ideal_cycle_s + "s" : "—"}</td>
                    <td className="muted">{a?.next_maintenance_due ?? "—"}</td>
                    <td className="muted">{a?.service_provider ?? "—"}</td>
                  </tr>
                );
              })}
              {!assets.length && <tr><td colSpan={7} className="dim">no asset registry (config/assets.yaml)</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* detail drawer */}
      {sel && (
        <div className="drawer">
          <span className="x" onClick={() => onSelect(sel.station_id)}>✕</span>
          <h3 style={{ fontSize: 16, margin: "0 0 2px", textTransform: "none", letterSpacing: 0, color: "var(--text)" }}>
            {sel.station_id} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{selAsset?.name ?? ""}</span>
          </h3>
          <div style={{ margin: "6px 0 14px" }}><StatusPill state={sel.state} /></div>
          <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 14px" }}>
            <Donut value={selK?.oee ?? 0} label="OEE" size={128} />
          </div>
          <Row k="Availability" v={pct(selK?.availability ?? 0) + "%"} />
          <Row k="Performance" v={pct(selK?.performance ?? 0) + "%"} />
          <Row k="Quality" v={pct(selK?.quality ?? 0) + "% (assumed)"} />
          <Row k="Utilization" v={pct(selK?.utilization ?? 0) + "%"} />
          <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />
          <Row k="MTBF" v={selOee?.mtbf_s != null ? selOee.mtbf_s + " s" : "no downs in window"} />
          <Row k="MTTR" v={selOee?.mttr_s != null ? selOee.mttr_s + " s" : "—"} />
          <Row k="Parts completed" v={String(sel.part_count)} />
          <Row k="Last cycle" v={sel.cycle_time_s != null ? sel.cycle_time_s.toFixed(1) + " s" : "—"} />
          <Row k="Current draw" v={sel.current_a != null ? sel.current_a.toFixed(2) + " A" : "—"} />
          <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />
          <Row k="Type" v={selAsset?.type ?? "—"} />
          <Row k="Nameplate cycle" v={selAsset?.ideal_cycle_s != null ? selAsset.ideal_cycle_s + " s" : "—"} />
          <Row k="Next maintenance" v={selAsset?.next_maintenance_due ?? "—"} />
          <Row k="Service provider" v={selAsset?.service_provider ?? "—"} />
        </div>
      )}
    </div>
  );
}

// ---- Warehouse: a live "pick slips" board (representative, generated client-side
// from real Toyota-style part numbers + bin addresses so the WMS story reads). ----
const WH_SKUS = ["90119-T0140", "48815-0K040", "53801-0K900", "17801-31170", "04152-YZZA6", "90915-YZZE1", "44310-0K010", "28100-0L050", "81110-0K330", "52119-0K905", "87139-YZZ08", "48609-0K040"];
const WH_STATUS = [["released", "var(--idle)"], ["picking", "var(--running)"], ["staged", "var(--blocked)"], ["packing", "var(--maintenance)"], ["loaded", "var(--running)"]] as const;
function whBin() {
  const fl = Math.random() < 0.5 ? 1 : 0;
  const aisle = String(1 + Math.floor(Math.random() * 24)).padStart(2, "0");
  const rack = String(1 + Math.floor(Math.random() * 30)).padStart(2, "0");
  const lvl = "ABCDE"[Math.floor(Math.random() * 5)] + (1 + Math.floor(Math.random() * 4));
  return { addr: `A${fl}-${aisle}-${rack}-${lvl}`, floor: fl };
}
function genSlips() {
  return Array.from({ length: 9 }).map((_, i) => {
    const b = whBin();
    const st = WH_STATUS[Math.floor(Math.random() * WH_STATUS.length)];
    return {
      order: "WO-" + (48200 + Math.floor(Math.random() * 900)),
      sku: WH_SKUS[Math.floor(Math.random() * WH_SKUS.length)],
      qty: 1 + Math.floor(Math.random() * 6),
      addr: b.addr, floor: b.floor, status: st[0], color: st[1] as string, key: i,
    };
  });
}
function WarehousePickSlips({ active }: { active: number }) {
  const [slips, setSlips] = useState(genSlips);
  useEffect(() => { const t = setInterval(() => setSlips(genSlips()), 4500); return () => clearInterval(t); }, []);
  return (
    <div className="card">
      <div className="h">
        <h3>Live pick slips</h3>
        <span className="sub">{slips.length} active tasks · {active} zones working <span className="stat s-part" style={{ border: "1px solid var(--idle)", color: "var(--idle)", borderRadius: 20, padding: "0 7px", fontSize: 9, marginLeft: 4 }}>representative</span></span>
      </div>
      <div className="scroll" style={{ boxShadow: "none", border: "none" }}>
        <table className="tbl">
          <thead><tr><th>Order</th><th>Part no.</th><th style={{ textAlign: "right" }}>Qty</th><th>Location</th><th>Floor</th><th>Status</th></tr></thead>
          <tbody>
            {slips.map((s) => (
              <tr key={s.key}>
                <td style={{ fontWeight: 700 }}>{s.order}</td>
                <td className="muted" style={{ fontFamily: "ui-monospace,monospace" }}>{s.sku}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.qty}</td>
                <td style={{ fontFamily: "ui-monospace,monospace" }}>{s.addr}</td>
                <td className="muted">{s.floor === 1 ? "Mezz · Small" : "Ground · Large"}</td>
                <td><span className="badge" style={{ background: s.color, color: "#08121f", textTransform: "uppercase", fontSize: 10 }}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Representative truck-loading cycle: one truck at a dock fills over ~30 s, then
// dispatches and a fresh empty truck backs in. The SAME formula drives the 3D
// dock fill in Floor3D (TRUCK_CYCLE_S there), so the KPI tracks what you see.
const TRUCK_CYCLE_S = 30, TRUCK_DOCKS = 3;
export function truckLoad(tSec: number) {
  const u = (((tSec % TRUCK_CYCLE_S) + TRUCK_CYCLE_S) % TRUCK_CYCLE_S) / TRUCK_CYCLE_S;
  const pct = Math.min(100, Math.round((u / 0.9) * 100));   // reaches 100% at u=0.9, then holds "full"
  const dock = 1 + (Math.floor(tSec / TRUCK_CYCLE_S) % TRUCK_DOCKS);
  return { pct, dock, full: pct >= 100 };
}
function TruckKpiTile() {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 700); return () => clearInterval(t); }, []);
  const { pct, dock, full } = truckLoad(Date.now() / 1000);
  return (
    <div className="card tile">
      <div className="lbl">Truck completion</div>
      <div className="val" style={{ color: full ? "var(--running)" : undefined }}>{pct}<small> %</small></div>
      <div style={{ height: 6, borderRadius: 4, background: "var(--border-soft)", overflow: "hidden", margin: "6px 0 5px" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: full ? "var(--running)" : "var(--idle)", transition: "width .6s ease" }} />
      </div>
      <div className="foot">{full ? "full · dispatching" : `loading · dock ${dock}/3`}</div>
    </div>
  );
}

function Tile({ label, val, unit, foot }: { label: string; val: string; unit?: string; foot?: string }) {
  return (
    <div className="card tile">
      <div className="lbl">{label}</div>
      <div className="val">{val}{unit && <small> {unit}</small>}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-soft)" }}>
      <span className="muted">{k}</span><b style={{ textAlign: "right" }}>{v}</b>
    </div>
  );
}
