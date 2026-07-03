-- URL persistente del documento en Cloudinary (los archivos locales de
-- Railway son efimeros entre deploys)
ALTER TABLE "documents" ADD COLUMN "url" TEXT;
