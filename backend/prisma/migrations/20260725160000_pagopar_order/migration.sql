-- CreateTable
CREATE TABLE "pagopar_orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "montoTotal" INTEGER NOT NULL,
    "hashPedido" TEXT,
    "idPedidoComercio" TEXT NOT NULL,
    "pagado" BOOLEAN NOT NULL DEFAULT false,
    "fechaPago" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagopar_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pagopar_orders_hashPedido_key" ON "pagopar_orders"("hashPedido");

-- CreateIndex
CREATE UNIQUE INDEX "pagopar_orders_idPedidoComercio_key" ON "pagopar_orders"("idPedidoComercio");

-- AddForeignKey
ALTER TABLE "pagopar_orders" ADD CONSTRAINT "pagopar_orders_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
