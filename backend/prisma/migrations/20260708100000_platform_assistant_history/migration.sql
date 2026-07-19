-- Historial persistente del asistente de plataforma (dashboard), privado por usuario
CREATE TABLE "platform_assistant_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_assistant_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_assistant_messages_userId_createdAt_idx"
    ON "platform_assistant_messages"("userId", "createdAt");

ALTER TABLE "platform_assistant_messages" ADD CONSTRAINT "platform_assistant_messages_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
