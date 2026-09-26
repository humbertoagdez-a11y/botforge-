-- Pedidos concretos que dejo un cliente final y de los que hay que avisarle al
-- dueño del negocio.
--
-- Por que una tabla y no una columna en conversations: en una misma
-- conversacion un cliente puede pedir hoy y volver a pedir la semana que
-- viene. Con una marca booleana el segundo pedido no avisaria, que es
-- exactamente la venta que se pierde. Ademas el panel necesita mostrar QUE
-- pidio, no solo que pidio algo.
--
-- Las tablas van en snake_case por el @@map de cada modelo.
CREATE TABLE "pedido_avisos" (
  "id" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  -- 'pedido' | 'turno' | 'contacto'. Texto y no enum: si mañana aparece otro
  -- tipo de cierre no hace falta una migracion para admitirlo.
  "tipo" TEXT NOT NULL,
  "resumen" TEXT NOT NULL,
  "nombreCliente" TEXT,
  "contacto" TEXT,
  -- false si el email no salio. El pedido queda igual: el panel es la red de
  -- contencion cuando falla el correo.
  "avisado" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pedido_avisos_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "pedido_avisos" ADD CONSTRAINT "pedido_avisos_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pedido_avisos" ADD CONSTRAINT "pedido_avisos_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Para el panel: "mostrame los pedidos de este bot, los mas nuevos primero"
CREATE INDEX "pedido_avisos_botId_createdAt_idx" ON "pedido_avisos"("botId", "createdAt");
-- Para la deduplicacion y para marcar la conversacion en la lista
CREATE INDEX "pedido_avisos_conversationId_idx" ON "pedido_avisos"("conversationId");
