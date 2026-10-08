-- Cuentas internas o de prueba (demos para capturas, pruebas de punta a punta).
-- Sus pasos no suman al embudo por origen (embudo_diario, /admin/origen), asi
-- se pueden usar en produccion sin ensuciar las metricas.
ALTER TABLE "users" ADD COLUMN "cuentaInterna" BOOLEAN NOT NULL DEFAULT false;
