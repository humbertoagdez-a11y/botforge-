-- AlterTable: verificacion de email + contadores del asistente por plan
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "assistantMsgsThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "assistantMsgsToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "assistantResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN "assistantDayResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Los usuarios que ya existian se registraron antes de que la verificacion
-- fuera obligatoria: quedan verificados para no bloquearles la cuenta.
UPDATE "users" SET "emailVerified" = true, "emailVerifiedAt" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verification_codes_userId_idx" ON "email_verification_codes"("userId");

-- AddForeignKey
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
