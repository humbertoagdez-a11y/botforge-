-- CreateEnum
CREATE TYPE "NpsSentiment" AS ENUM ('PROMOTOR', 'PASIVO', 'DETRACTOR');

-- AlterTable: encuesta apagada por defecto en todos los bots existentes
ALTER TABLE "bots" ADD COLUMN "npsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "nps_responses" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "conversationId" TEXT,
    "clientId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "sentiment" "NpsSentiment" NOT NULL,
    "comment" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nps_prompts" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nps_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nps_responses_botId_createdAt_idx" ON "nps_responses"("botId", "createdAt");
CREATE INDEX "nps_responses_botId_clientId_idx" ON "nps_responses"("botId", "clientId");
CREATE INDEX "nps_responses_botId_sentiment_idx" ON "nps_responses"("botId", "sentiment");
CREATE UNIQUE INDEX "nps_prompts_botId_clientId_key" ON "nps_prompts"("botId", "clientId");
CREATE INDEX "nps_prompts_botId_askedAt_idx" ON "nps_prompts"("botId", "askedAt");

-- AddForeignKey
ALTER TABLE "nps_responses" ADD CONSTRAINT "nps_responses_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nps_prompts" ADD CONSTRAINT "nps_prompts_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
