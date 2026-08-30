# Local Development Stack (Docker Compose)

A reproducible local stack for the Learnault API: **API**, **wallet worker**, **scheduler**, **PostgreSQL**, and **Redis** — started with one command.

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
#    learnault-dev-scheduler  Up ...
```

The API is available at `http://localhost:5000` (Swagger UI at `http://localhost:5000/api-docs`).

## What happens on startup

The `api` service entrypoint (`docker/entrypoint-dev-api.sh`) waits for PostgreSQL and Redis health, then:

1. Applies pending migrations (`prisma migrate deploy`) — deterministic, no-op when up to date.
2. Seeds deterministic fixtures (`prisma db seed`) — idempotent, safe to run repeatedly.
3. Starts the Express server under `nodemon`, so source edits hot-reload via the bind mount.

The `worker` service runs `src/workers/wallet-provisioning.worker.ts`, which polls the idempotent wallet-provisioning outbox and generates Stellar keys through the dev in-memory KMS adapter. In production, swap the KMS adapter for a real one (e.g. AWS KMS) behind the same `KmsSecretStore` interface.

The `scheduler` service runs `src/workers/scheduler.worker.ts`. See below.

## Scheduled job runner

Every recurring queue drain is owned by the `scheduler` service, not by the request that enqueued the work — so a delivery whose `nextAttemptAt` falls due is retried on time even when the API is receiving no traffic, and request latency never includes queue-drain work.

Registered queues: `email`, `notification`, `webhook`, `stellar-funding`, `data-export`, `account-lifecycle`.

Each tick takes a row lease on `queue_leases` via `JobLeaseService.acquireQueueLease()` before draining, so extra replicas are safe:

```bash
docker compose up -d --scale scheduler=2
```

A replica that loses the race logs a skipped tick and moves on; a replica that crashes mid-drain has its lease expire, and the next tick reclaims the queue.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCHEDULER_INTERVAL_MS` | `15000` | Base tick interval for every queue |
| `SCHEDULER_<QUEUE>_INTERVAL_MS` | — | Per-queue override, e.g. `SCHEDULER_WEBHOOK_INTERVAL_MS` |
| `SCHEDULER_LEASE_MS` | `60000` | Lease held per tick (floored at 2× the interval) |
| `SCHEDULER_QUEUES` | all | Comma list restricting which queues this replica runs |
| `SCHEDULER_DISABLED_QUEUES` | — | Comma list of queues to skip |
| `SCHEDULER_SHUTDOWN_TIMEOUT_MS` | `30000` | How long `SIGTERM` waits for in-flight ticks |
| `SCHEDULER_IN_PROCESS` | `false` | Opt-in: run the runner inside the API process for single-process deployments |
| `LIFECYCLE_SWEEP_INTERVAL_MS` | `0` | When `> 0`, overrides the `account-lifecycle` queue interval |

Every tick emits a structured log line carrying per-queue `depth`, `due`, `lagMs` (age of the oldest due row), `durationMs`, and cumulative `attempts` / `failures` / `skipped`.

`pnpm scheduler:verify` runs both evidence scenarios against the stack: a due-but-failed delivery drained with no inbound HTTP traffic, then a batch drained by two replicas with no row processed twice.

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
pnpm stack:logs      # follow API + worker + scheduler logs
pnpm stack:validate  # docker compose config --quiet
pnpm stack:smoke     # validate + start + probe health endpoints
```

## Logs & graceful shutdown

```bash
docker compose logs -f          # all services
docker compose logs -f api      # API only
docker compose logs worker      # worker only
docker compose logs -f scheduler # scheduled job runner only
```

`api` and `worker` have `stop_grace_period: 30s` and `scheduler` has `40s`, matching each process's graceful-shutdown handler (`SHUTDOWN_TIMEOUT_MS` / `SCHEDULER_SHUTDOWN_TIMEOUT_MS`): `docker compose down` sends `SIGTERM`, the server drains HTTP connections and closes the Prisma pool before exiting, and the scheduler stops scheduling, waits for in-flight ticks, and releases their queue leases so no queue is left parked.

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
