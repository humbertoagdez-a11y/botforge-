-- CreateTable
CREATE TABLE "consolidated_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "content" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "consolidated_reports_userId_weekStart_key" ON "consolidated_reports"("userId", "weekStart");
CREATE INDEX "consolidated_reports_userId_weekStart_idx" ON "consolidated_reports"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "consolidated_reports" ADD CONSTRAINT "consolidated_reports_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
