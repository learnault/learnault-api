# ============================================================================
# Learnault API — Production Docker Image
#
# Multi-stage build with three stages:
#   deps   – install production-only node_modules (cached layer)
#   build  – install all deps, generate Prisma client, compile TypeScript
#   runtime – minimal image with non-root user, health check, entrypoints
#
# Build:
#   docker build -t learnault-api .
#
# Run (API):
#   docker run -d -p 5000:5000 --env-file .env learnault-api
#
# Run (Worker):
#   docker run -d --env-file .env \
#     -e WORKER_SCRIPT=dist/workers/credit.js \
#     --entrypoint ./entrypoint-worker.sh learnault-api
#
# Migrations (one-off):
#   docker run --rm --env-file .env -e RUN_MIGRATIONS=true learnault-api
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Production dependencies (cache-friendly)
# ---------------------------------------------------------------------------
FROM node:20-slim AS deps

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage 2: Build — TypeScript compilation + Prisma client generation
# ---------------------------------------------------------------------------
FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
COPY tsconfig.json ./

RUN npx prisma generate
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: Runtime — minimal production image
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Prisma CLI (globally) — needed by entrypoints for optional migrate deploy
RUN npm install -g prisma@7.4.2 && npm cache clean --force

# Production dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Generated Prisma client from stage 2
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Compiled application
COPY --from=build /app/dist ./dist

# Application metadata
COPY --from=build /app/package.json ./

# Prisma schema + migrations (required at runtime for migrate deploy)
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

# Entrypoint scripts
COPY docker/entrypoint-api.sh  ./entrypoint-api.sh
COPY docker/entrypoint-worker.sh ./entrypoint-worker.sh
COPY docker/entrypoint-scheduler.sh ./entrypoint-scheduler.sh

RUN chmod +x entrypoint-api.sh entrypoint-worker.sh entrypoint-scheduler.sh

# Non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd  --uid 1001 --gid appgroup --shell /bin/sh --create-home appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:5000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint-api.sh"]
