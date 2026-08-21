-- Rotating refresh tokens with family linkage and reuse detection.
--
-- Each row is one opaque refresh token (stored as a SHA-256 hash only — the
-- raw token is never persisted). Rows sharing a `familyId` form a rotation
-- family: a successful refresh consumes the presented token (ACTIVE → ROTATED)
-- and mints a new ACTIVE row in the same family. Presenting a ROTATED token is
-- treated as theft and revokes the entire family plus its parent session.

CREATE TABLE "refresh_tokens" (
    "id"        TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "familyId"  TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status"    TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Uniquely index the token hash for O(1) lookup during refresh.
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- Fast family/session revocation during reuse detection and logout.
CREATE INDEX "refresh_tokens_familyId_status_idx" ON "refresh_tokens"("familyId", "status");
CREATE INDEX "refresh_tokens_sessionId_status_idx" ON "refresh_tokens"("sessionId", "status");

-- Cascade so session deletion (account deletion finalization) also removes
-- its refresh-token family.
ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
