#!/usr/bin/env bash
set -euo pipefail

command -v docker >/dev/null 2>&1 || export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"

PGUSER_="${POSTGRES_USER:-learnault}"
PGDB_="${POSTGRES_DB:-learnault_dev}"
PGPORT_="${POSTGRES_PORT:-5433}"

export DATABASE_URL="${DATABASE_URL:-postgresql://${PGUSER_}:learnault@localhost:${PGPORT_}/${PGDB_}?schema=public}"
export NODE_ENV="${NODE_ENV:-production}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

echo "==> Starting PostgreSQL"
docker compose up -d db >/dev/null 2>&1
until docker compose exec -T db pg_isready -U "$PGUSER_" -d "$PGDB_" >/dev/null 2>&1; do sleep 1; done

HAS_OUTBOX="$(docker compose exec -T db psql -U "$PGUSER_" -d "$PGDB_" -qAt \
  -c "SELECT to_regclass('public.outbox_events');" | tr -d '\r')"

if [ -z "$HAS_OUTBOX" ]; then
  echo "==> Syncing schema"
  npx prisma db push --accept-data-loss >/dev/null 2>&1
fi

exec npx tsx scripts/relay-verification.ts
