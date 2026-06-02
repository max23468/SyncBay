CREATE TYPE "ProductPublicationMode" AS ENUM ('ALL', 'SELECTED', 'NONE');

ALTER TABLE "Shop"
ADD COLUMN "productPublicationMode" "ProductPublicationMode" NOT NULL DEFAULT 'ALL',
ADD COLUMN "productPublicationGids" TEXT;
