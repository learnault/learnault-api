# Staging Deployment Runbook

This document details the processes and configurations for the Learnault API Staging Environment.

## Overview

The staging environment is deployed using an immutable Docker image digest. The deployment automates configuration validation, database migrations, readiness checks, smoke tests, and graceful rollbacks.

## Deployment Pipeline

1. **Build & Tag:** A new Docker image is built for every commit to `main` using a multi-stage `Dockerfile`.
2. **Predeploy Checks:** The `deploy-staging.sh` script validates the environment configuration (`config/staging.env.example`).
3. **Migrations:** Prisma migrations are applied _before_ the application starts using the newly built image (`npx prisma migrate deploy`).
4. **Deploy & Await:** The API container is deployed via Docker Compose and the script polls `/health` until readiness is confirmed.
5. **Smoke Tests:** `smoke-test.sh` runs a suite of safe, read-only API tests (e.g., `/health`) to verify operational sanity.
6. **Rollback:** If any step fails, the `rollback-staging.sh` script is triggered automatically to revert the API container to the _previous_ immutable image digest.

## Migration-Forward Policy

**CRITICAL: We never rollback the database.**

In the event of a failed deployment that included a bad database migration:

1. The rollback script _only_ reverts the API container to the previous image.
2. Because the schema cannot be safely rolled back in PostgreSQL without risking data loss, **the previous API version must be backward compatible with the new schema**, or the environment will remain broken.
3. If the environment is broken, the engineering team must immediately write a _forward migration_ (a new PR) to fix the schema or drop the problematic changes safely.

### How to apply a fix:

1. Create a new branch.
2. Fix the broken logic or write a new Prisma migration (`npx prisma migrate dev --name fix_schema`).
3. Merge the PR. The pipeline will automatically build a new image, run the new migration, and deploy.

## Configuration (Secrets Contract)

See `config/staging.env.example` for the list of required environment variables. These are typically stored in GitHub Secrets and injected during the CI/CD pipeline.

## Manual Execution

To rehearse the deployment locally:

```bash
# 1. Build an image
docker build -t learnault-api:test-tag .

# 2. Deploy
export DATABASE_URL="postgresql://user:pass@localhost:5432/db"
export JWT_SECRET="secret"
./scripts/deploy-staging.sh test-tag

# 3. Smoke Test
./scripts/smoke-test.sh

# 4. Rollback (Requires a previously built tag)
./scripts/rollback-staging.sh old-tag
```
