-- Datos del cobro que hasta ahora solo quedaban en el log del webhook.
-- El numero de comprobante es con lo que se concilia un pago ante un reclamo,
-- y la forma de pago evita tener que reconsultarle a Pagopar cada vez que
-- alguien abre el detalle del pedido.
ALTER TABLE "pagopar_orders" ADD COLUMN "formaPago" TEXT;
ALTER TABLE "pagopar_orders" ADD COLUMN "numeroComprobante" TEXT;
