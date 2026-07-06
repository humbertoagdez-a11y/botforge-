-- Opt-out del resumen diario por email (default: habilitado)
ALTER TABLE "users" ADD COLUMN "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT true;
