-- Wallet provisioning stores public Stellar material and opaque KMS references only.
CREATE TABLE "managed_key_references" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "opaqueReference" TEXT NOT NULL,
    "keyVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "managed_key_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "custody" TEXT NOT NULL DEFAULT 'MANAGED',
    "publicKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "managedKeyReferenceId" TEXT,
    "failureCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "provisionedAt" TIMESTAMP(3),
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_provisioning_jobs" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lastFailureCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallet_provisioning_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "managed_key_references_opaqueReference_key" ON "managed_key_references"("opaqueReference");
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");
CREATE UNIQUE INDEX "wallets_publicKey_key" ON "wallets"("publicKey");
CREATE UNIQUE INDEX "wallets_managedKeyReferenceId_key" ON "wallets"("managedKeyReferenceId");
CREATE INDEX "wallets_status_updatedAt_idx" ON "wallets"("status", "updatedAt");
CREATE UNIQUE INDEX "wallet_provisioning_jobs_walletId_key" ON "wallet_provisioning_jobs"("walletId");
CREATE INDEX "wallet_provisioning_jobs_status_availableAt_idx" ON "wallet_provisioning_jobs"("status", "availableAt");
CREATE INDEX "wallet_provisioning_jobs_status_leasedUntil_idx" ON "wallet_provisioning_jobs"("status", "leasedUntil");

ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_managedKeyReferenceId_fkey" FOREIGN KEY ("managedKeyReferenceId") REFERENCES "managed_key_references"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_provisioning_jobs" ADD CONSTRAINT "wallet_provisioning_jobs_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
