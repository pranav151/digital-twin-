# Frontend — React + Vite + Recharts (Phases 6–7)

Live dashboard (Monitor pillar) + 2D SVG floor view (Visualize pillar), fed by the
backend `/ws/live` WebSocket and REST.

- `src/App.tsx` — WS connection, tabs, rolling throughput series, bottleneck poll
- `src/pages/Dashboard.tsx` — OEE gauge, availability/throughput/bottleneck cards,
  live throughput chart, machine-state timeline, per-station utilization, issues
- `src/pages/WhatIf.tsx` — run `/api/simulate/whatif`, show predicted vs baseline
- `src/components/FloorView.tsx` — top-down SVG line, stations colored by live state,
  click to select; bottleneck marked
- `src/components/charts.tsx` — gauge, bars, timeline, issues, throughput chart

## Run
```bash
# backend on :8000 (or set BACKEND_PORT to match)
BACKEND_PORT=8000 npm run dev      # http://localhost:5173  (proxies /api and /ws)
npm run build                      # type-check + production build to dist/
```
Node v18+ (v24 installed). Vite proxies `/api` and `/ws` to the backend
(`BACKEND_PORT`, default 8000).
