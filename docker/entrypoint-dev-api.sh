#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Learnault API — Development Container Entrypoint
#
# Environment variables:
#   RUN_MIGRATIONS = "true" (default) → apply pending migrations on boot
#   RUN_SEED       = "true" (default) → seed deterministic fixtures on boot
# ---------------------------------------------------------------------------

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Applying database migrations …"
  npx prisma migrate deploy
  echo "[entrypoint] Migrations applied."
fi

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "[entrypoint] Seeding database (deterministic fixtures) …"
  npx prisma db seed
  echo "[entrypoint] Seed complete."
fi

echo "[entrypoint] Starting API dev server (nodemon) …"
exec pnpm dev
