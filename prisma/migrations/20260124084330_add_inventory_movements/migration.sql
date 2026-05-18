-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "movement_type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryMovement_company_id_factory_id_item_id_idx" ON "InventoryMovement"("company_id", "factory_id", "item_id");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
