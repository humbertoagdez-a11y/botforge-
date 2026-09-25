-- Notas de voz: marcar el mensaje y guardar cuanto duraba el audio.
--
-- Hasta ahora la transcripcion entraba como texto plano, indistinguible de uno
-- escrito: el dueño leia el mensaje en el panel sin saber que el cliente habia
-- mandado un audio, y sin poder juzgar si una transcripcion rara venia de una
-- grabacion mala.
--
-- audioSegundos va aparte del flag porque la duracion es lo que explica una
-- transcripcion pobre: 8 segundos entrecortados no se leen igual que 90.
--
-- La tabla es "messages", del @@map del modelo Message.
ALTER TABLE "messages" ADD COLUMN "esNotaDeVoz" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "messages" ADD COLUMN "audioSegundos" INTEGER;
