-- Embudo por origen: de donde llega la gente y hasta donde avanza, contado de
-- forma agregada y anonima.
--
-- Es un CONTADOR por dia: no hay IP, ni user agent, ni fbclid, ni ningun id de
-- persona o de dispositivo. Las etiquetas son de la campaña, no de la persona:
--   origen   meta-anuncio-web | meta-anuncio-whatsapp | directo | otro | sin-dato
--   campana  utm_campaign, normalizado y cortado a 60 caracteres
--   anuncio  utm_content (el nombre del anuncio), igual
--   pagina   en "visita", la pagina de entrada (/, /planes, /auth/register)
--   tipo     visita | registro | verificado | bot | primer-mensaje |
--            whatsapp | pago-iniciado | pagado
CREATE TABLE "embudo_diario" (
  "fecha" DATE NOT NULL,
  "origen" TEXT NOT NULL,
  "campana" TEXT NOT NULL DEFAULT '',
  "anuncio" TEXT NOT NULL DEFAULT '',
  "pagina" TEXT NOT NULL DEFAULT '',
  "tipo" TEXT NOT NULL,
  "cantidad" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "embudo_diario_pkey" PRIMARY KEY ("fecha", "origen", "campana", "anuncio", "pagina", "tipo")
);

-- En la cuenta, SOLO el origen normalizado (texto corto de la lista de
-- arriba): nunca fbclid ni utm. Es lo que permite que los pasos posteriores
-- al registro sumen al origen correcto sin guardar nada del visitante.
ALTER TABLE "users" ADD COLUMN "origenRegistro" TEXT;
-- Para contar el "primer mensaje en el chat de prueba" una sola vez
ALTER TABLE "users" ADD COLUMN "primerChatPruebaEn" TIMESTAMP(3);
