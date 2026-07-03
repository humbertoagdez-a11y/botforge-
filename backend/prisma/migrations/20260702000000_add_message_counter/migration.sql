-- Contador mensual de mensajes por usuario (enforcement de limites de plan)
ALTER TABLE "users" ADD COLUMN "messagesUsedThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "messagesResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
