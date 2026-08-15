-- Cupo propio del Chat de prueba del panel.
-- Hasta ahora el Chat de prueba descontaba del mismo contador que los mensajes
-- de clientes reales: probar el bot 30 veces le sacaba 30 mensajes al negocio.
-- A partir de acá lleva su propio contador, con su propio tope por plan.
ALTER TABLE "users" ADD COLUMN "testMsgsThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "testMsgsToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "testResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN "testDayResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
