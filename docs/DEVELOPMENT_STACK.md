# Local Development Stack (Docker Compose)

A reproducible local stack for the Learnault API: **API**, **wallet worker**, **PostgreSQL**, and **Redis** — started with one command.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2 (bundled with Docker Desktop)
- Node.js 20+ and pnpm 10+ (only needed for `pnpm` helper scripts; the stack itself is containerized)

## Quick Start

```bash
# 1. Configure environment (create once; defaults work out of the box)
cp .env.example .env

# 2. One command builds and starts a healthy stack
docker compose up -d --build

# 3. Verify everything is healthy
docker compose ps
#    NAME                  STATUS
#    learnault-dev-api     Up ... (healthy)
#    learnault-dev-db      Up ... (healthy)
#    learnault-dev-redis   Up ... (healthy)
#    learnault-dev-worker  Up ... (healthy)
```

The API is available at `http://localhost:5000` (Swagger UI at `http://localhost:5000/api-docs`).

## What happens on startup

The `api` service entrypoint (`docker/entrypoint-dev-api.sh`) waits for PostgreSQL and Redis health, then:

1. Applies pending migrations (`prisma migrate deploy`) — deterministic, no-op when up to date.
2. Seeds deterministic fixtures (`prisma db seed`) — idempotent, safe to run repeatedly.
3. Starts the Express server under `nodemon`, so source edits hot-reload via the bind mount.

The `worker` service runs `src/workers/wallet-provisioning.worker.ts`, which polls the idempotent wallet-provisioning outbox and generates Stellar keys through the dev in-memory KMS adapter. In production, swap the KMS adapter for a real one (e.g. AWS KMS) behind the same `KmsSecretStore` interface.

## Health checks & readiness

| Endpoint            | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `GET /health/live`  | Process is alive (used by the container healthcheck) |
| `GET /health/ready` | Dependencies (database) are reachable                |

The API container only reports **healthy** after `/health/live` responds; `depends_on: condition: service_healthy` keeps the worker from racing migrations. `GET /health/ready` returns `200` only when PostgreSQL is reachable — the smoke test waits on it.

## One-command helpers

`package.json` exposes convenient wrappers:

```bash
pnpm stack:up        # docker compose up -d --build
pnpm stack:down      # stop the stack (keeps data volumes)
pnpm stack:reset     # stop + delete data volumes (project-scoped reset)
pnpm stack:logs      # follow API + worker logs
pnpm stack:validate  # docker compose config --quiet
pnpm stack:smoke     # validate + start + probe health endpoints
```

## Logs & graceful shutdown

```bash
docker compose logs -f          # all services
docker compose logs -f api      # API only
docker compose logs worker      # worker only
```

Both services have `stop_grace_period: 30s`, matching the app's graceful-shutdown handler (`SHUTDOWN_TIMEOUT_MS`): `docker compose down` sends `SIGTERM`, the server drains HTTP connections and closes the Prisma pool before exiting.

## Data persistence & reset

- PostgreSQL data lives in the `learnault-dev_pgdata` named volume; Redis in `learnault-dev_redisdata`.
- **Reset is project-scoped**: `docker compose down -v` removes only this project's volumes. Other projects and containers are untouched.

```bash
# Full project-scoped reset (drops all local data, then rebuild + reseed)
pnpm stack:reset
pnpm stack:up
```

## Smoke test

```bash
pnpm stack:smoke
```

This validates the compose file, starts the stack, waits for `/health/ready`, probes `/health/live` and `/health/ready`, and prints service status. Run `./scripts/stack-smoke-test.sh --validate` for config-only validation.

## Troubleshooting

| Symptom                              | Fix                                                                  |
| ------------------------------------ | -------------------------------------------------------------------- |
| Port 5432/6379/5000 already in use   | Override in `.env`: `POSTGRES_PORT=5433`, `REDIS_PORT=6380`, `API_PORT=5001` |
| Prisma client errors (`@prisma/client` export) | Run `pnpm db:generate` (or `docker compose build`), then restart the stack |
| `JWT_SECRET` required error          | Set a real `JWT_SECRET` in `.env` (defaults are dev-only)             |
| Containers restarting after reset    | Ensure `.env` exists before `docker compose up`                        |

## Related

- [Prisma Setup Guide](../prisma/SETUP.md) — database schema, migrations, seeding
- [Staging Runbook](./RUNBOOK.md) — production/staging deployment
- [Architecture](./ARCHITECTURE.md) — service design
