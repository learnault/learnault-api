#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "[entrypoint] Running database migrations …"
  npx prisma migrate deploy
  echo "[entrypoint] Migrations applied."
fi

echo "[entrypoint] Starting scheduled job runner …"
exec node dist/workers/scheduler.worker.js
