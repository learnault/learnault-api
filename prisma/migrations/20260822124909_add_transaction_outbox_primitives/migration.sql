-- CreateTable "outbox_events"
-- Implements transactional outbox pattern for reliable event delivery across:
-- - PostgreSQL domain changes
-- - Asynchronous job queues
-- - Third-party notifications and blockchain providers
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP,
    "source" TEXT,
    "causedBy" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex for outbox_events
CREATE INDEX "outbox_events_aggregateId_aggregateType_idx" ON "outbox_events"("aggregateId", "aggregateType");
CREATE INDEX "outbox_events_eventType_status_idx" ON "outbox_events"("eventType", "status");
CREATE INDEX "outbox_events_status_publishedAt_idx" ON "outbox_events"("status", "publishedAt");
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");
CREATE INDEX "outbox_events_createdAt_idx" ON "outbox_events"("createdAt");

-- CreateTable "job_attempts"
-- Tracks lease-based job processing with retry, backoff, and dead-lettering
-- - One JobAttempt per (OutboxEvent, jobType) pair
-- - LeaseToken ensures only one worker processes the job concurrently
-- - Idempotent completion prevents duplicate side effects from retries
CREATE TABLE "job_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outboxEventId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP,
    "availableAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "backoffMultiplier" REAL NOT NULL DEFAULT 2.0,
    "backoffBaseMs" INTEGER NOT NULL DEFAULT 1000,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP,
    "idempotencyKey" TEXT,
    "completedAt" TIMESTAMP,
    "result" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_attempts_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "outbox_events" ("id") ON DELETE CASCADE,
    CONSTRAINT "job_attempts_leaseToken_key" UNIQUE("leaseToken"),
    CONSTRAINT "job_attempts_idempotencyKey_key" UNIQUE("idempotencyKey")
);

-- CreateIndex for job_attempts
CREATE INDEX "job_attempts_outboxEventId_status_idx" ON "job_attempts"("outboxEventId", "status");
CREATE INDEX "job_attempts_jobType_status_idx" ON "job_attempts"("jobType", "status");
CREATE INDEX "job_attempts_status_availableAt_idx" ON "job_attempts"("status", "availableAt");
CREATE INDEX "job_attempts_status_leasedUntil_idx" ON "job_attempts"("status", "leasedUntil");
CREATE INDEX "job_attempts_status_createdAt_idx" ON "job_attempts"("status", "createdAt");
CREATE INDEX "job_attempts_createdAt_idx" ON "job_attempts"("createdAt");

-- CreateTable "rolled_back_records"
-- Markers for rolled-back events and jobs to prevent workers from processing them
-- Written in separate transaction to avoid circular dependencies
CREATE TABLE "rolled_back_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex for rolled_back_records
CREATE INDEX "rolled_back_records_recordType_recordId_idx" ON "rolled_back_records"("recordType", "recordId");
CREATE INDEX "rolled_back_records_createdAt_idx" ON "rolled_back_records"("createdAt");
