/*
  Warnings:

  - Added the required column `keyPrefix` to the `ApiKey` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "keyPrefix" TEXT NOT NULL,
ADD COLUMN     "revokedAt" TIMESTAMP(3);
