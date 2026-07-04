-- Vencimiento del access token de Drive (para el futuro flujo de refresh OAuth2)
ALTER TABLE "drive_connections" ADD COLUMN "expiresAt" TIMESTAMP(3);
