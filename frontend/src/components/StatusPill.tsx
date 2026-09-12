import { STATE_COLOR, STATE_ICON, STATE_LABEL, type MachineState } from "../types";

/** Machine state as colour + glyph + label — never colour alone (ISA-101, backlog A3). */
export function StatusPill({ state, size = "md" }: { state: MachineState; size?: "sm" | "md" }) {
  const c = STATE_COLOR[state] || "#6b7482";
  const small = size === "sm";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: small ? 11 : 12, fontWeight: 700, color: c,
      padding: small ? "1px 7px" : "2px 9px", borderRadius: 20,
      border: `1px solid ${c}`, lineHeight: 1.5, whiteSpace: "nowrap",
    }}>
      <span aria-hidden style={{ fontSize: small ? 9 : 10 }}>{STATE_ICON[state]}</span>
      {STATE_LABEL[state] || state}
    </span>
  );
}
