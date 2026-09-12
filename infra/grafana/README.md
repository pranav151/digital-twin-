# Grafana + InfluxDB — historical analytics (opt-in)

Top-5 recon item #3: a production-grade time-series historian (InfluxDB) with
Grafana dashboards for KPIs and long-horizon historical analysis, layered on the
`InfluxHistorian` the app already supports — **no app rewrite**.

> ⚠️ Scaffolded and written to standard, but **not run in this sandbox** (no Docker
> available here). Verify on a host with Docker before relying on it.

## Run
```bash
cd infra/grafana
docker compose up -d
```
- Grafana → http://localhost:3000 (admin / `factorytwin`, or `$GRAFANA_PASSWORD`)
- InfluxDB → http://localhost:8086

## Point the app at it
Run the backend + ingestion with the Influx historian instead of SQLite:
```bash
HISTORIAN_BACKEND=influx \
INFLUX_URL=http://localhost:8086 INFLUX_ORG=factory INFLUX_BUCKET=telemetry \
INFLUX_TOKEN=dev-token-change-me \
./.venv/bin/uvicorn backend.app.main:app --port 8020
```
Ingestion then writes telemetry to InfluxDB, and the provisioned Grafana datasource
(`FactoryTwin-Influx`) reads the same bucket. Build panels in Grafana against the
`telemetry` measurement — `state_code`, `part_count`, `current_a`, `cycle_time_s`,
tagged by `station_id`.

## Starter Flux (OEE inputs)
```flux
from(bucket: "telemetry")
  |> range(start: -8h)
  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "part_count")
  |> group(columns: ["station_id"])
  |> derivative(unit: 1h, nonNegative: true)   // parts/hr per station
```

## TimescaleDB alternative
Prefer Postgres/Timescale? Swap the InfluxDB service for `timescale/timescaledb`
and implement a `TimescaleHistorian(Historian)` in
`services/common/historian.py` (same interface as `SqliteHistorian` /
`InfluxHistorian`); Grafana's Postgres datasource then reads it. That backend
implementation is the one remaining piece of work for the Timescale path.
