-- Configuracion de notificaciones por email del asistente
CREATE TABLE "notification_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_configs_botId_event_key" ON "notification_configs"("botId", "event");

ALTER TABLE "notification_configs" ADD CONSTRAINT "notification_configs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_configs" ADD CONSTRAINT "notification_configs_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
