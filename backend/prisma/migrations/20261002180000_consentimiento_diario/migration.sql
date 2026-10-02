-- Cuantas personas aceptan las cookies, contado de forma anonima.
--
-- Hace falta para saber cuanto del trafico del anuncio Meta llega a ver: el
-- pixel solo se carga si la persona elige "Aceptar". Sin este numero no hay
-- forma de distinguir "el anuncio no trae gente" de "trae gente que dice que
-- no a las cookies".
--
-- Es un CONTADOR por dia, no un registro de visitas: no hay IP, ni user agent,
-- ni id de navegador, ni nada que permita reconocer a una persona. Por eso no
-- necesita consentimiento para existir.
--
-- conAnuncio separa las filas de quienes llegaron con fbclid en la URL. Es un
-- booleano: el valor del fbclid NO se guarda.
CREATE TABLE "consentimiento_diario" (
  "fecha" DATE NOT NULL,
  "conAnuncio" BOOLEAN NOT NULL,
  "mostrado" INTEGER NOT NULL DEFAULT 0,
  "todas" INTEGER NOT NULL DEFAULT 0,
  "necesarias" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "consentimiento_diario_pkey" PRIMARY KEY ("fecha", "conAnuncio")
);
