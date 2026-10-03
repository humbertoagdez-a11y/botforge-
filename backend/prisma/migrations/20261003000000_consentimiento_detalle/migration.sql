-- Mas detalle en el contador anonimo del banner de cookies, sin identificar a
-- nadie: siguen siendo sumas por dia, ahora partidas por tres etiquetas
-- gruesas que no distinguen personas.
--
-- dispositivo: 'movil' o 'escritorio', por el ancho de pantalla (< 768 px).
--              Las filas de antes quedan como 'sin_dato'.
-- variante:    que diseño de banner vio ('actual' o 'nueva'), para el A/B.
--
-- ignorado:          vio el banner y siguio usando el sitio sin elegir
--                    (cambio de pagina o scrolleo mas de una pantalla).
-- todasRapidas /
-- necesariasRapidas: eligio en menos de 1 segundo desde que aparecio. Si una
--                    variante sube las aceptaciones a base de toques sin leer,
--                    es que empuja.
ALTER TABLE "consentimiento_diario" ADD COLUMN "dispositivo" TEXT NOT NULL DEFAULT 'sin_dato';
ALTER TABLE "consentimiento_diario" ADD COLUMN "variante" TEXT NOT NULL DEFAULT 'actual';
ALTER TABLE "consentimiento_diario" ADD COLUMN "ignorado" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "consentimiento_diario" ADD COLUMN "todasRapidas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "consentimiento_diario" ADD COLUMN "necesariasRapidas" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "consentimiento_diario" DROP CONSTRAINT "consentimiento_diario_pkey";
ALTER TABLE "consentimiento_diario"
  ADD CONSTRAINT "consentimiento_diario_pkey" PRIMARY KEY ("fecha", "conAnuncio", "dispositivo", "variante");
