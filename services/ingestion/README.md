# Ingestion service — Phase 2 (stub)

Subscribes to `factory/+/+/telemetry` and `factory/+/+/event`, validates against
`services/common` schemas, writes to InfluxDB per the schema (state → state_code).
Handles broker reconnects. DoD: 10 min of emulator data lands in InfluxDB and a
Flux query returns per-station cycle times + events.
