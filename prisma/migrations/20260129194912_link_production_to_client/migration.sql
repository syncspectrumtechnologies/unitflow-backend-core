-- DropIndex
DROP INDEX "ProductionLog_company_id_factory_id_item_id_idx";

-- AlterTable
ALTER TABLE "ProductionLog" ADD COLUMN     "client_id" TEXT,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(65,30);

-- CreateIndex
CREATE INDEX "ProductionLog_company_id_factory_id_idx" ON "ProductionLog"("company_id", "factory_id");

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
