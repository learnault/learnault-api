-- Add device/browser/OS/location metadata and lastUsedAt to sessions table.
-- These fields are populated from User-Agent parsing and IP geo-lookup at
-- login time and are used by the session listing endpoint.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "deviceName"  TEXT,
  ADD COLUMN IF NOT EXISTS "browser"     TEXT,
  ADD COLUMN IF NOT EXISTS "os"          TEXT,
  ADD COLUMN IF NOT EXISTS "country"     TEXT,
  ADD COLUMN IF NOT EXISTS "city"        TEXT,
  ADD COLUMN IF NOT EXISTS "fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "lastUsedAt"  TIMESTAMP(3);

-- Index for efficient per-user active-session queries ordered by lastUsedAt.
CREATE INDEX IF NOT EXISTS "sessions_userId_isRevoked_lastUsedAt_idx"
  ON "sessions"("userId", "isRevoked", "lastUsedAt");
