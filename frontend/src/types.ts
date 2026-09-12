export type MachineState =
  | "running" | "idle" | "blocked" | "down" | "starved" | "maintenance" | "offline";

// Data provenance — honest labeling of real hardware vs the emulator.
export type SourceType =
  | "simulated" | "real_opcua" | "real_mtconnect" | "real_modbus" | "historical_replay" | "mixed";

export interface StationLive {
  station_id: string;
  line_id?: string | null;       // which plant/line (from assets.yaml) — scopes floor + rail
  state: MachineState;
  online?: boolean;
  current_a: number;
  part_count: number;
  cycle_time_s: number | null;
  part_present: boolean;
  source?: SourceType;
  spindle_rpm?: number | null;   // real MTConnect spindle velocity (real machines only)
}

export interface StationKpi {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  utilization: number;
}

export interface Snapshot {
  ts: number;
  stations: StationLive[];
  kpi: {
    stations: Record<string, StationKpi>;
    line: { units_per_hr: number; terminal_station: string };
  };
  issues: { ts: string; station_id: string; event_type: string; reason: string }[];
  parts?: { part_id: string; ts: string; lead_time_s: number }[];
  source?: SourceType;   // line-level provenance for the top-bar badge
}

// How each provenance reads in the UI. `real` gets a saturated cue because it
// signals real hardware is on the wire; simulated/replay stay neutral.
export const SOURCE_BADGE: Record<SourceType, { label: string; real: boolean }> = {
  simulated:         { label: "Simulated",   real: false },
  real_opcua:        { label: "Live · OPC-UA",    real: true },
  real_mtconnect:    { label: "Live · MTConnect", real: true },
  real_modbus:       { label: "Live · Modbus",    real: true },
  historical_replay: { label: "Replay",      real: false },
  mixed:             { label: "Live + Sim",  real: true },
};

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface HealthRow {
  station_id: string;
  name?: string;
  health: number;               // 0-100 condition score
  risk: RiskTier;
  rul_hours: number | null;     // estimated remaining useful life
  rul_days: number | null;
  availability: number;
  performance: number;
  down_count: number;
  mtbf_s: number | null;
  cycle_drift_pct: number | null;
  signal: string;               // dominant degradation driver
  monitoring_only: boolean;     // real/external machine with no part signal
}

export interface Health {
  line_id: string;
  window: string;
  nominal_life_h: number;
  stations: HealthRow[];
  note: string;
}

export const RISK_COLOR: Record<RiskTier, string> = {
  low: "#3fb950", medium: "#d29922", high: "#db6d28", critical: "#f85149",
};

export interface TimelineSeg {
  start: string;
  end: string;
  state: MachineState;
  duration_s: number;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  ideal_cycle_s: number | null;
  next_maintenance_due: string | null;
  service_provider: string | null;
  x?: number;   // floor coords (metres) from the layout config
  z?: number;
  level?: number;   // 0 = ground, 1 = mezzanine (warehouse multi-floor)
  model?: string;   // optional real GLTF/GLB model URL (else procedural geometry)
}

export interface Zone {
  id: string; label: string; x: number; z: number; w: number; d: number;
}

export interface Layout {
  line_id: string;
  line_name: string | null;
  product?: string | null;
  stations: Asset[];
  flow: [string, string][];
  zones: Zone[];
}

// ISA-101 status scale: saturated colour ONLY encodes state, and always with a label.
export const STATE_COLOR: Record<MachineState, string> = {
  running: "#3fb950",      // good
  idle: "#d29922",         // warning (amber, survives red-green CVD)
  blocked: "#db6d28",      // serious
  down: "#f85149",         // critical
  starved: "#6f9fc0",      // waiting for upstream (steel blue)
  maintenance: "#9b6dd6",  // planned service (violet)
  offline: "#6b7482",      // no signal (neutral grey)
};

export const STATE_LABEL: Record<MachineState, string> = {
  running: "Running",
  idle: "Idle",
  blocked: "Blocked",
  down: "Down",
  starved: "Starved",
  maintenance: "Maintenance",
  offline: "Offline",
};

// Redundant encoding: a glyph paired with every status colour (greyscale-safe).
export const STATE_ICON: Record<MachineState, string> = {
  running: "▶",
  idle: "◐",
  blocked: "▮",
  down: "■",
  starved: "◇",
  maintenance: "⚙",
  offline: "○",
};
