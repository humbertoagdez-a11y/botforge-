-- Conexion de Google Drive por bot (carpeta de catalogo de imagenes)
CREATE TABLE "drive_connections" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "folderName" TEXT NOT NULL DEFAULT 'catálogo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drive_connections_botId_key" ON "drive_connections"("botId");

ALTER TABLE "drive_connections" ADD CONSTRAINT "drive_connections_botId_fkey"
    FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
