/*
  Warnings:

  - You are about to drop the column `token` on the `sessions` table. All the data in the column will be lost.
  - Added the required column `familyId` to the `sessions` table without a default value. This is not possible if the table is not empty.
  - Made the column `refreshToken` on table `sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "sessions_token_key";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "token",
ADD COLUMN     "familyId" TEXT NOT NULL,
ADD COLUMN     "parentId" TEXT,
ALTER COLUMN "refreshToken" SET NOT NULL;

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");
