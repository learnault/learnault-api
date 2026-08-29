-- ─────────────────────────────────────────────────────────────────────────────
-- AUDITABLE DATA LIFECYCLE AND ARCHIVE POLICY
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds the two structures the lifecycle policy needs at the database level:
--
--   1. "audit_events" — the immutable audit spine. Append-only, enforced by a
--      trigger rather than by convention, because an audit trail an application
--      bug can quietly rewrite is not an audit trail.
--
--   2. Archive columns on archivable models, so withdrawing a record that other
--      records depend on is a soft delete instead of a cascade.
--
-- See docs/DATA_LIFECYCLE.md for the full lifecycle matrix.

-- CreateTable "audit_events"
-- Deliberately has no foreign key to "users": a cascade would let erasure
-- destroy the trail, and SET NULL would mutate a row that must never change.
-- "actorId" and "targetId" are soft references.
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    -- Actor: who caused the change
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    -- Action and target: what changed
    "action" TEXT NOT NULL,
    "recordClass" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    -- Justification and correlation
    "reason" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT,
    "source" TEXT,
    -- Safe context: redacted JSON, keyed IP hash, coarse User-Agent family
    "metadata" TEXT,
    "actorIpHash" TEXT,
    "userAgentFamily" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_targetType_targetId_occurredAt_idx" ON "audit_events"("targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_actorType_actorId_occurredAt_idx" ON "audit_events"("actorType", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_action_occurredAt_idx" ON "audit_events"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_events_requestId_idx" ON "audit_events"("requestId");

-- CreateIndex
CREATE INDEX "audit_events_occurredAt_idx" ON "audit_events"("occurredAt");


-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABILITY ENFORCEMENT
-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE is rejected unconditionally. DELETE is rejected unless the caller has
-- set "learnault.audit_purge" for the current transaction, which only
-- AuditEventService.purgeExpired() does — and it deletes by timestamp, so the
-- escape hatch cannot be used to remove one specific inconvenient event.
--
-- SECURITY DEFINER is not used: the check must apply to every role, including
-- the migration owner.
CREATE OR REPLACE FUNCTION "audit_events_reject_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'audit_events rows are immutable: UPDATE is not permitted (row %)', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- TG_OP = 'DELETE'. current_setting(..., true) returns NULL rather than
    -- raising when the setting has never been assigned in this session.
    IF coalesce(current_setting('learnault.audit_purge', true), 'off') <> 'on' THEN
        RAISE EXCEPTION
            'audit_events rows may only be deleted by the retention purge (row %)', OLD."id"
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- DROP ... IF EXISTS before each CREATE so this block can be re-applied. It is
-- also how `prisma db push` environments (which skip migration SQL entirely,
-- and so never get these triggers) can bootstrap them — see
-- tests/integration/audit-immutability.test.ts.
DROP TRIGGER IF EXISTS "audit_events_no_update" ON "audit_events";
CREATE TRIGGER "audit_events_no_update"
    BEFORE UPDATE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION "audit_events_reject_mutation"();

DROP TRIGGER IF EXISTS "audit_events_no_delete" ON "audit_events";
CREATE TRIGGER "audit_events_no_delete"
    BEFORE DELETE ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION "audit_events_reject_mutation"();

-- TRUNCATE bypasses row-level triggers entirely, so it needs a statement-level
-- one of its own. Without this, `TRUNCATE audit_events` would erase the whole
-- trail despite the row triggers above.
CREATE OR REPLACE FUNCTION "audit_events_reject_truncate"()
RETURNS TRIGGER AS $$
BEGIN
    IF coalesce(current_setting('learnault.audit_purge', true), 'off') <> 'on' THEN
        RAISE EXCEPTION 'audit_events may not be truncated'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_events_no_truncate" ON "audit_events";
CREATE TRIGGER "audit_events_no_truncate"
    BEFORE TRUNCATE ON "audit_events"
    FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_reject_truncate"();


-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHIVE COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
-- ARCHIVABLE models only. A row is withdrawn by stamping "archivedAt"; reads
-- exclude archived rows by default via the Prisma extension in
-- src/audit/archive.ts. "archivedById" is a soft reference to users.id, not a
-- foreign key, so archive attribution survives the actor's own erasure.

-- AlterTable: learner_profiles
ALTER TABLE "learner_profiles"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "archivedById" TEXT,
    ADD COLUMN "archivedReason" TEXT;

-- AlterTable: Module
ALTER TABLE "Module"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "archivedById" TEXT,
    ADD COLUMN "archivedReason" TEXT;

-- AlterTable: avatars
ALTER TABLE "avatars"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "archivedById" TEXT,
    ADD COLUMN "archivedReason" TEXT;

-- AlterTable: referral_codes
ALTER TABLE "referral_codes"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "archivedById" TEXT,
    ADD COLUMN "archivedReason" TEXT;

-- AlterTable: WebhookEndpoint
ALTER TABLE "WebhookEndpoint"
    ADD COLUMN "archivedAt" TIMESTAMP(3),
    ADD COLUMN "archivedById" TEXT,
    ADD COLUMN "archivedReason" TEXT;

-- CreateIndex
-- Serves both sides of the archive filter: the "archivedAt" IS NULL predicate
-- every default read carries, and the range scan the retention purge runs over
-- archived rows. Plain rather than partial so it matches the @@index in
-- schema.prisma and no drift is reported.
CREATE INDEX "learner_profiles_archivedAt_idx" ON "learner_profiles"("archivedAt");
CREATE INDEX "Module_archivedAt_idx" ON "Module"("archivedAt");
CREATE INDEX "avatars_archivedAt_idx" ON "avatars"("archivedAt");
CREATE INDEX "referral_codes_archivedAt_idx" ON "referral_codes"("archivedAt");
CREATE INDEX "WebhookEndpoint_archivedAt_idx" ON "WebhookEndpoint"("archivedAt");

-- An archived row must always say why and when. Enforced in the database
-- because "archive" is a write that lands from several call sites, and a row
-- archived without a reason is indistinguishable from an accident months later.
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_archive_reason_check"
    CHECK ("archivedAt" IS NULL OR "archivedReason" IS NOT NULL);
ALTER TABLE "Module" ADD CONSTRAINT "Module_archive_reason_check"
    CHECK ("archivedAt" IS NULL OR "archivedReason" IS NOT NULL);
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_archive_reason_check"
    CHECK ("archivedAt" IS NULL OR "archivedReason" IS NOT NULL);
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_archive_reason_check"
    CHECK ("archivedAt" IS NULL OR "archivedReason" IS NOT NULL);
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_archive_reason_check"
    CHECK ("archivedAt" IS NULL OR "archivedReason" IS NOT NULL);
