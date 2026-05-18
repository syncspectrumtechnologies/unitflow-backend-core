-- CreateTable
CREATE TABLE "OrderFulfillment" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderFulfillment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderFulfillment" ADD CONSTRAINT "OrderFulfillment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "OrderFulfillment_company_id_order_id_idx" ON "OrderFulfillment"("company_id", "order_id");
CREATE INDEX "OrderFulfillment_company_id_factory_id_created_at_idx" ON "OrderFulfillment"("company_id", "factory_id", "created_at");
CREATE INDEX "OrderFulfillment_company_id_order_id_product_id_idx" ON "OrderFulfillment"("company_id", "order_id", "product_id");
