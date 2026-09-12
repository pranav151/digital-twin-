import { useEffect, useRef, useState } from "react";
import { getCopilotStatus, postAsk } from "../api";

const SUGGESTIONS = [
  "Why is S3 the bottleneck?",
  "What if I speed up S3 by 20%?",
  "What's the single best change to raise throughput?",
  "Where are we losing the most time?",
];

interface Msg { role: "user" | "assistant"; text: string; tools?: string[]; }

export function Copilot({ window: win }: { window: string }) {
  const [avail, setAvail] = useState<boolean | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { getCopilotStatus().then((s) => setAvail(s.available)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput(""); setBusy(true);
    try {
      const r = await postAsk(q, win);
      setMsgs((m) => [...m, { role: "assistant", text: r.answer || "(no answer)", tools: r.tools_used }]);
      if (r.available === false) setAvail(false);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", text: "Error: " + (e.message || "failed") }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 840, margin: "0 auto" }}>
      <div className="h"><h3>Operations copilot</h3><span className="sub">natural language over the live twin</span></div>
      {avail === false && (
        <div className="dim" style={{ padding: "6px 0 10px", fontSize: 13 }}>
          Copilot is off — set <code>ANTHROPIC_API_KEY</code> on the backend and restart to enable.
          It answers by calling the same live endpoints the dashboard uses (bottleneck, KPIs, what-if, optimiser).
        </div>
      )}
      <div style={{ minHeight: 260, maxHeight: 440, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "6px 0" }}>
        {!msgs.length && <div className="dim">Ask about the line — try a suggestion below.</div>}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%" }}>
            <div style={{
              background: m.role === "user" ? "var(--panel-3)" : "var(--panel-2)",
              border: "1px solid var(--border)", borderRadius: 12, padding: "9px 13px",
              fontSize: 14, whiteSpace: "pre-wrap",
            }}>
              {m.text}
              {m.tools?.length ? <div className="dim" style={{ fontSize: 10, marginTop: 6 }}>via {m.tools.join(", ")}</div> : null}
            </div>
          </div>
        ))}
        {busy && <div className="dim" style={{ alignSelf: "flex-start" }}>thinking…</div>}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 12px" }}>
        {SUGGESTIONS.map((s) => <span key={s} className="chip btn" onClick={() => send(s)}>{s}</span>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && send(input)} placeholder="Ask the copilot…" />
        <button className="primary" onClick={() => send(input)} disabled={busy}>Ask</button>
      </div>
    </div>
  );
}
