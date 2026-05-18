-- CreateTable
CREATE TABLE "ProductionLog" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "production_date" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionLog_company_id_factory_id_item_id_idx" ON "ProductionLog"("company_id", "factory_id", "item_id");

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
