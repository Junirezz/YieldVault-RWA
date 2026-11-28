# Local observability stack

Runs Prometheus, Grafana, Tempo, and a backend instance wired to export
traces, for local testing of the dashboards described in
[`docs/MONITORING_OBSERVABILITY.md`](../docs/MONITORING_OBSERVABILITY.md).

## Setup

```bash
cp monitoring/.env.example monitoring/.env
# edit monitoring/.env and set a real GRAFANA_ADMIN_PASSWORD
docker compose --env-file monitoring/.env -f monitoring/docker-compose.yml up
```

Grafana is served on http://localhost:3001 (admin / the password from `.env`),
Prometheus on http://localhost:9090, and Tempo's OTLP endpoint on
`tempo:4318` inside the compose network (the `backend` service already
points `OTEL_EXPORTER_OTLP_ENDPOINT` at it).
