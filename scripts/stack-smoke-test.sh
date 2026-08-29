#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Learnault API — Local Stack Smoke Test
#
# Validates docker-compose.yml, starts the stack, and verifies the API is
# live and ready. Used by `pnpm stack:smoke` and by CI.
#
# Usage:
#   ./scripts/stack-smoke-test.sh            # validate + start + probe
#   ./scripts/stack-smoke-test.sh --validate # config validation only
# ---------------------------------------------------------------------------

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
API_URL="${API_URL:-http://localhost:5000}"
MAX_RETRIES=60
RETRY_INTERVAL=2

echo "==> Validating compose configuration ($COMPOSE_FILE)"
docker compose -f "$COMPOSE_FILE" config --quiet
echo "==> Compose configuration is valid"

if [ "${1:-}" = "--validate" ]; then
  exit 0
fi

echo "==> Building and starting the stack"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for dependencies and API readiness ($API_URL/health/ready)"
ready=false
for ((i = 1; i <= MAX_RETRIES; i++)); do
  if curl -fsS "$API_URL/health/ready" >/dev/null 2>&1; then
    ready=true
    break
  fi
  echo "    ... attempt $i/$MAX_RETRIES"
  sleep "$RETRY_INTERVAL"
done

if [ "$ready" != "true" ]; then
  echo "!! API did not become ready in time" >&2
  docker compose -f "$COMPOSE_FILE" logs api
  exit 1
fi

echo "==> Liveness probe (GET $API_URL/health/live)"
curl -fsS "$API_URL/health/live"
echo

echo "==> Readiness probe (GET $API_URL/health/ready)"
curl -fsS "$API_URL/health/ready"
echo

echo "==> Service status"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "✅ Smoke test passed"
