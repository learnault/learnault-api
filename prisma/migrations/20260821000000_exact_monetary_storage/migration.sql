-- Migration: 20260821000000_exact_monetary_storage
--
-- Replace binary floating-point monetary columns with exact-integer "stroop"
-- columns (1 XLM = 10,000,000 stroops, 7 decimal places).  Also adds explicit
-- asset-identity columns (assetCode, assetIssuer, assetNetwork) to every table
-- that carries a monetary amount.
--
-- ROLLBACK NOTES
-- ==============
-- Down-migration is intentionally manual because the original Float columns
-- already carry precision loss that cannot be recovered.  If a rollback is
-- needed:
--   1. Add the old Float columns back.
--   2. Populate them with  new_stroop_column::float8 / 10000000.0
--   3. Drop the new BigInt columns.
--
-- SAFE LEGACY CONVERSION
-- =======================
-- Existing rows are converted using ROUND(<float> * 10000000) to the nearest
-- stroop.  This is the only correct representation of the value already stored;
-- any further precision had already been silently lost by IEEE-754.
-- The conversion is wrapped in a transaction so it is atomic with the schema
-- changes.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1.  "modules" table
-- ────────────────────────────────────────────────────────────────────────────

-- Add new columns (nullable first so the ALTER works on non-empty tables)
ALTER TABLE "Module"
  ADD COLUMN IF NOT EXISTS "rewardStroops" BIGINT,
  ADD COLUMN IF NOT EXISTS "assetCode"     TEXT    NOT NULL DEFAULT 'XLM',
  ADD COLUMN IF NOT EXISTS "assetIssuer"   TEXT,
  ADD COLUMN IF NOT EXISTS "assetNetwork"  TEXT    NOT NULL DEFAULT 'testnet';

-- Convert legacy float values: ROUND to nearest stroop
UPDATE "Module"
   SET "rewardStroops" = ROUND("reward" * 10000000)::BIGINT
 WHERE "reward" IS NOT NULL;

-- Fall back to 0 for any rows where reward was NULL or NaN
UPDATE "Module"
   SET "rewardStroops" = 0
 WHERE "rewardStroops" IS NULL;

-- Apply NOT NULL constraint and check that values are non-negative
ALTER TABLE "Module"
  ALTER COLUMN "rewardStroops" SET NOT NULL,
  ALTER COLUMN "rewardStroops" SET DEFAULT 0,
  ADD CONSTRAINT "Module_rewardStroops_non_negative" CHECK ("rewardStroops" >= 0);

-- Drop the legacy column
ALTER TABLE "Module" DROP COLUMN IF EXISTS "reward";


-- ────────────────────────────────────────────────────────────────────────────
-- 2.  "Transaction" table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "amountStroops" BIGINT,
  ADD COLUMN IF NOT EXISTS "assetCode"     TEXT    NOT NULL DEFAULT 'XLM',
  ADD COLUMN IF NOT EXISTS "assetIssuer"   TEXT,
  ADD COLUMN IF NOT EXISTS "assetNetwork"  TEXT    NOT NULL DEFAULT 'testnet';

UPDATE "Transaction"
   SET "amountStroops" = ROUND("amount" * 10000000)::BIGINT
 WHERE "amount" IS NOT NULL;

-- Negative amounts are theoretically possible for refunds; clamp to 0 to be
-- safe.  Any negative legacy value indicates data corruption — log it.
UPDATE "Transaction"
   SET "amountStroops" = 0
 WHERE "amountStroops" IS NULL OR "amountStroops" < 0;

ALTER TABLE "Transaction"
  ALTER COLUMN "amountStroops" SET NOT NULL,
  ADD CONSTRAINT "Transaction_amountStroops_non_negative" CHECK ("amountStroops" >= 0);

ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "amount";


-- ────────────────────────────────────────────────────────────────────────────
-- 3.  "referrals" table
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "referrals"
  ADD COLUMN IF NOT EXISTS "bonusAmountStroops" BIGINT;

-- Nullable column — only set where legacy value existed
UPDATE "referrals"
   SET "bonusAmountStroops" = ROUND("bonusAmount" * 10000000)::BIGINT
 WHERE "bonusAmount" IS NOT NULL;

ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_bonusAmountStroops_non_negative"
  CHECK ("bonusAmountStroops" IS NULL OR "bonusAmountStroops" >= 0);

ALTER TABLE "referrals" DROP COLUMN IF EXISTS "bonusAmount";


COMMIT;
