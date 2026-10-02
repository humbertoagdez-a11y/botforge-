-- Atribucion de conversiones a los anuncios de Meta (API de Conversiones).
--
-- SOLO se llena cuando la persona eligio "Aceptar" en el banner de cookies.
-- Con "Solo las necesarias" estas columnas quedan en NULL y a Meta no se le
-- manda nada, ni por el navegador ni por el servidor: es lo que el banner le
-- promete.

-- En el usuario: los identificadores de Meta que traia al registrarse, para
-- poder atribuir una compra que pasa dias despues.
ALTER TABLE "users" ADD COLUMN "metaConsentimiento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "metaConsentimientoEn" TIMESTAMP(3);
-- fbc: el click del anuncio, en el formato de la cookie _fbc
ALTER TABLE "users" ADD COLUMN "metaFbc" TEXT;
-- fbp: el navegador, como lo identifica el pixel (cookie _fbp)
ALTER TABLE "users" ADD COLUMN "metaFbp" TEXT;

-- En la orden: lo que hace falta para mandar el Purchase desde el webhook de
-- Pagopar, donde no hay navegador. IP y user agent se guardan porque Meta los
-- usa para emparejar el evento con la persona, y en el webhook no existen.
ALTER TABLE "pagopar_orders" ADD COLUMN "metaConsentimiento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pagopar_orders" ADD COLUMN "metaFbc" TEXT;
ALTER TABLE "pagopar_orders" ADD COLUMN "metaFbp" TEXT;
ALTER TABLE "pagopar_orders" ADD COLUMN "metaIp" TEXT;
ALTER TABLE "pagopar_orders" ADD COLUMN "metaUserAgent" TEXT;
