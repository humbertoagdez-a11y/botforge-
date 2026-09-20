-- Marca si la respuesta llego de verdad al cliente.
-- Default true: lo existente se da por entregado y los canales web/widget
-- entregan en la respuesta HTTP misma.
ALTER TABLE "messages" ADD COLUMN "entregado" BOOLEAN NOT NULL DEFAULT true;
