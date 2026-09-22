-- Numero legible del cliente conectado por Embedded Signup.
-- metaPhoneNumberId es un id opaco; el panel necesita el numero real.
ALTER TABLE "bots" ADD COLUMN "metaDisplayNumber" TEXT;
