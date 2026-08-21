#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Learnault Worker — Development Container Entrypoint
#
# Environment variables:
#   RUN_MIGRATIONS = "true" (default) → apply pending migrations on boot
# ---------------------------------------------------------------------------

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations …"
  npx prisma migrate deploy
  echo "[entrypoint] Migrations applied."
fi

echo "[entrypoint] Starting wallet-provisioning worker …"
exec pnpm worker:dev
