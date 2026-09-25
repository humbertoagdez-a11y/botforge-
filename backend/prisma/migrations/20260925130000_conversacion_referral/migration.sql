-- Atribucion de anuncios Click-to-WhatsApp.
--
-- Cuando alguien toca "Enviar mensaje" en un anuncio de Meta, el webhook trae
-- un objeto `referral` en el PRIMER mensaje de esa conversacion, con el id del
-- anuncio, su titular y el ctwa_clid. Si no se guarda ahi, se pierde: los
-- mensajes siguientes ya no lo traen.
--
-- Sin esto, pautar es tirar plata a ciegas: llegan conversaciones y no hay
-- forma de saber cual anuncio las trajo.
--
-- Va en la conversacion y no en el mensaje porque el anuncio es el origen de
-- TODA la conversacion, no de un mensaje suelto.
--
-- La tabla es "conversations", del @@map del modelo Conversation.
ALTER TABLE "conversations" ADD COLUMN "adSourceId" TEXT;
ALTER TABLE "conversations" ADD COLUMN "adSourceType" TEXT;
ALTER TABLE "conversations" ADD COLUMN "adSourceUrl" TEXT;
ALTER TABLE "conversations" ADD COLUMN "adHeadline" TEXT;
ALTER TABLE "conversations" ADD COLUMN "adBody" TEXT;
ALTER TABLE "conversations" ADD COLUMN "ctwaClid" TEXT;

-- Para poder listar "todas las conversaciones que trajo el anuncio X"
CREATE INDEX "conversations_adSourceId_idx" ON "conversations"("adSourceId");
