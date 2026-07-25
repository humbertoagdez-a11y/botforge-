-- AlterTable: CI o RUC del usuario, requerido por Pagopar al iniciar un pago.
-- Nullable: solo se completa cuando el usuario va a pagar por primera vez.
ALTER TABLE "users" ADD COLUMN "documento" TEXT;
