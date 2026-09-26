-- Donde recibe el dueño los avisos de avisar_pedido.
--
-- Hasta ahora el aviso salia siempre por email a la cuenta del dueño. Un
-- pedido de rotiseria tiene minutos de vida util: el dueño esta en el local,
-- no mirando el correo. WhatsApp le llega al bolsillo.
--
-- Las tablas van en snake_case por el @@map de cada modelo: Bot vive en "bots".
ALTER TABLE "bots" ADD COLUMN "avisoCelular" TEXT;

-- 'email' | 'whatsapp' | 'ambos'. En NULL decide el celular: si hay uno
-- cargado el aviso va por WhatsApp, si no por email. Se deja nullable a
-- proposito en vez de poner 'email' por defecto, porque un default fijo
-- obligaria al dueño a volver a elegir despues de cargar el celular, y cargar
-- el celular YA es elegir WhatsApp.
ALTER TABLE "bots" ADD COLUMN "avisoCanal" TEXT;

-- Por que canal salio realmente cada aviso. Sin esto, cuando el dueño dice
-- "no me llego", no hay forma de saber si se intento WhatsApp y cayo a email,
-- o si nunca salio nada.
ALTER TABLE "pedido_avisos" ADD COLUMN "canal" TEXT;
