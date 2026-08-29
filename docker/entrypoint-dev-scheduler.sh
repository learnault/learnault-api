#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations …"
  npx prisma migrate deploy
  echo "[entrypoint] Migrations applied."
fi

echo "[entrypoint] Starting scheduled job runner …"
exec pnpm scheduler:dev
