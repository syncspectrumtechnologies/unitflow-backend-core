-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "ClientProduct" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientProduct_company_id_factory_id_client_id_idx" ON "ClientProduct"("company_id", "factory_id", "client_id");

-- AddForeignKey
ALTER TABLE "ClientProduct" ADD CONSTRAINT "ClientProduct_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
