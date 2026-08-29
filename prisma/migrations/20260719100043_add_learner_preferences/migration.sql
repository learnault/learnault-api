-- CreateTable
CREATE TABLE "learner_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "lowDataMode" BOOLEAN NOT NULL DEFAULT false,
    "highContrast" BOOLEAN NOT NULL DEFAULT false,
    "reduceMotion" BOOLEAN NOT NULL DEFAULT false,
    "screenReaderOptimized" BOOLEAN NOT NULL DEFAULT false,
    "textSize" TEXT NOT NULL DEFAULT 'medium',
    "preferredDifficulty" TEXT NOT NULL DEFAULT 'beginner',
    "preferredCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profileVisibility" TEXT NOT NULL DEFAULT 'public',
    "analyticsConsent" BOOLEAN NOT NULL DEFAULT false,
    "dataSharingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preference_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preference_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learner_preferences_userId_key" ON "learner_preferences"("userId");

-- CreateIndex
CREATE INDEX "preference_audit_logs_userId_createdAt_idx" ON "preference_audit_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "learner_preferences" ADD CONSTRAINT "learner_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preference_audit_logs" ADD CONSTRAINT "preference_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
