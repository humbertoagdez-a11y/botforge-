-- AlterTable: id del numero de negocio de Meta Cloud API que rutea al bot
ALTER TABLE "bots" ADD COLUMN "metaPhoneNumberId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bots_metaPhoneNumberId_key" ON "bots"("metaPhoneNumberId");
