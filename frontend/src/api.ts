import type { Snapshot, TimelineSeg, Layout, Health } from "./types";

/** Open the live WebSocket, auto-reconnecting. Returns a close fn. */
export function connectLive(
  onSnapshot: (s: Snapshot) => void,
  onStatus: (connected: boolean) => void
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: number | undefined;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/live`);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (e) => {
      try { onSnapshot(JSON.parse(e.data)); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      onStatus(false);
      if (!closed) retry = window.setTimeout(open, 1500);
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closed = true;
    if (retry) window.clearTimeout(retry);
    ws?.close();
  };
}

async function getJSON<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url);
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

export const getTimeline = (station: string, window = "1h") =>
  getJSON<TimelineSeg[]>(`/api/timeline/${station}?window=${window}`, []);

export const getOee = (station: string, window = "1h") =>
  getJSON<any>(`/api/kpi/oee?station=${station}&window=${window}`, null);

export const getBottleneck = (line = "L1", window = "1h") =>
  getJSON<any>(`/api/analyze/bottleneck?line=${line}&window=${window}`, null);

export const getLosses = (line = "L1", window = "1h") =>
  getJSON<any>(`/api/kpi/losses?line=${line}&window=${window}`, null);

export const getHealth = (line = "L1", window = "1h") =>
  getJSON<Health | null>(`/api/analyze/health?line=${line}&window=${window}`, null);

export const getOptimize = (line = "L1", window = "1h") =>
  getJSON<any>(`/api/simulate/optimize?line=${line}&window=${window}&replications=5`, null);

export const getCopilotStatus = () =>
  getJSON<{ available: boolean }>(`/api/copilot/status`, { available: false });

export async function postAsk(question: string, window = "1h") {
  const r = await fetch(`/api/ask`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, window }),
  });
  if (!r.ok) throw new Error(`ask failed: ${r.status}`);
  return r.json();
}

export const getAssets = (line = "L1") =>
  getJSON<Layout>(`/api/assets?line=${line}`,
    { line_id: line, line_name: null, product: null, stations: [], flow: [], zones: [] });

export const getLines = () =>
  getJSON<{ id: string; name: string | null }[]>(`/api/lines`, [{ id: "ALL", name: "All lines" }]);

export const getThroughput = (line = "L1", window = "1h") =>
  getJSON<any>(`/api/kpi/throughput?line=${line}&window=${window}`, null);

export const getValidation = (line = "L1", window = "1h") =>
  getJSON<any>(`/api/simulate/validate?line=${line}&window=${window}&replications=8`, null);

export const getCalibrations = (line = "L1", limit = 20) =>
  getJSON<any[]>(`/api/calibrations?line=${line}&limit=${limit}`, []);

export async function postCalibrate(line = "L1", window = "15m") {
  const r = await fetch(`/api/calibrate?line=${line}&window=${window}`, { method: "POST" });
  if (!r.ok) throw new Error(`calibrate failed: ${r.status}`);
  return r.json();
}

export interface WhatIfChange {
  type: "cycle_reduction" | "add_operator" | "set_cycle" | "buffer_size";
  station?: string;
  percent?: number;
  operators?: number;
  value?: number;
}

export async function postWhatIf(body: {
  line: string; window: string; changes: WhatIfChange[]; replications?: number;
}) {
  const r = await fetch(`/api/simulate/whatif`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`what-if failed: ${r.status}`);
  return r.json();
}
