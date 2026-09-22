-- Embedded Signup: numero y token propios de cada cliente.
-- Todos nullable: los bots existentes quedan en null y siguen usando el
-- numero y el token globales de BotForge, igual que hasta ahora.
ALTER TABLE "bots" ADD COLUMN "metaWabaId" TEXT;
ALTER TABLE "bots" ADD COLUMN "metaBusinessId" TEXT;
ALTER TABLE "bots" ADD COLUMN "metaBusinessToken" TEXT;
ALTER TABLE "bots" ADD COLUMN "metaRegistrationPin" TEXT;
ALTER TABLE "bots" ADD COLUMN "metaConectadoEn" TIMESTAMP(3);
ALTER TABLE "bots" ADD COLUMN "metaEstado" TEXT;
