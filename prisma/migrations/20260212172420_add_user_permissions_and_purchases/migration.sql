-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED', 'CLOSED');

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserPermissionMap" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "UserPermissionMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "purchase_no" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor_name" TEXT NOT NULL,
    "vendor_gstin" TEXT,
    "vendor_phone" TEXT,
    "vendor_email" TEXT,
    "vendor_address" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "line_total" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseCharge" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseStatusHistory" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPermissionMap_company_id_user_id_idx" ON "UserPermissionMap"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionMap_company_id_user_id_permission_id_key" ON "UserPermissionMap"("company_id", "user_id", "permission_id");

-- CreateIndex
CREATE INDEX "Purchase_company_id_factory_id_status_idx" ON "Purchase"("company_id", "factory_id", "status");

-- CreateIndex
CREATE INDEX "Purchase_company_id_factory_id_purchase_date_idx" ON "Purchase"("company_id", "factory_id", "purchase_date");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_company_id_factory_id_purchase_no_key" ON "Purchase"("company_id", "factory_id", "purchase_no");

-- CreateIndex
CREATE INDEX "PurchaseItem_company_id_purchase_id_idx" ON "PurchaseItem"("company_id", "purchase_id");

-- CreateIndex
CREATE INDEX "PurchaseCharge_company_id_purchase_id_idx" ON "PurchaseCharge"("company_id", "purchase_id");

-- CreateIndex
CREATE INDEX "PurchaseStatusHistory_company_id_purchase_id_idx" ON "PurchaseStatusHistory"("company_id", "purchase_id");

-- CreateIndex
CREATE INDEX "PurchaseStatusHistory_company_id_status_idx" ON "PurchaseStatusHistory"("company_id", "status");

-- AddForeignKey
ALTER TABLE "UserPermissionMap" ADD CONSTRAINT "UserPermissionMap_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionMap" ADD CONSTRAINT "UserPermissionMap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionMap" ADD CONSTRAINT "UserPermissionMap_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCharge" ADD CONSTRAINT "PurchaseCharge_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCharge" ADD CONSTRAINT "PurchaseCharge_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStatusHistory" ADD CONSTRAINT "PurchaseStatusHistory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseStatusHistory" ADD CONSTRAINT "PurchaseStatusHistory_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
