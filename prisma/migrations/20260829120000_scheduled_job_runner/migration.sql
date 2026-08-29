CREATE TABLE "queue_leases" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "owner" TEXT,
    "lastTickAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "queue_leases_queueName_key" ON "queue_leases"("queueName");
CREATE INDEX "queue_leases_leasedUntil_idx" ON "queue_leases"("leasedUntil");
