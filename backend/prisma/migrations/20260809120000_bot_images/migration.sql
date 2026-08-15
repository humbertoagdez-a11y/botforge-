-- CreateTable
CREATE TABLE "bot_images" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_images_botId_idx" ON "bot_images"("botId");

-- AddForeignKey
ALTER TABLE "bot_images" ADD CONSTRAINT "bot_images_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
