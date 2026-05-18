/*
  Warnings:

  - You are about to drop the column `ip_address` on the `ActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `new_value` on the `ActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `old_value` on the `ActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `factory_id` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `gst_number` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `ClientContact` table. All the data in the column will be lost.
  - You are about to drop the column `factory_id` on the `ClientContact` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `ClientProduct` table. All the data in the column will be lost.
  - You are about to drop the column `factory_id` on the `ClientProduct` table. All the data in the column will be lost.
  - You are about to drop the column `product_name` on the `ClientProduct` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `Factory` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Factory` table. All the data in the column will be lost.
  - You are about to drop the column `item_id` on the `InventoryMovement` table. All the data in the column will be lost.
  - You are about to drop the column `movement_type` on the `InventoryMovement` table. All the data in the column will be lost.
  - You are about to drop the column `reference` on the `InventoryMovement` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_date` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_number` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `Invoice` table. All the data in the column will be lost.
  - The `status` column on the `Invoice` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `order_number` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `Order` table. All the data in the column will be lost.
  - The `status` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `invoice_id` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `paid_on` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `Permission` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `Permission` table. All the data in the column will be lost.
  - You are about to drop the column `client_id` on the `ProductionLog` table. All the data in the column will be lost.
  - You are about to drop the column `item_id` on the `ProductionLog` table. All the data in the column will be lost.
  - You are about to drop the column `production_date` on the `ProductionLog` table. All the data in the column will be lost.
  - You are about to alter the column `quantity` on the `ProductionLog` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Decimal(15,2)`.
  - You are about to drop the column `created_by` on the `Role` table. All the data in the column will be lost.
  - You are about to drop the column `created_by` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `is_active` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `UserFactoryMap` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `UserRoleMap` table. All the data in the column will be lost.
  - You are about to drop the `InventoryItem` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[company_id,company_name]` on the table `Client` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,client_id,product_id]` on the table `ClientProduct` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,name]` on the table `Factory` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,invoice_no]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,order_no]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,key]` on the table `Permission` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,name]` on the table `Role` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,user_id,factory_id]` on the table `UserFactoryMap` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,user_id,role_id]` on the table `UserRoleMap` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `company_name` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_id` to the `ClientProduct` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_id` to the `InventoryMovement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `source_type` to the `InventoryMovement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `type` to the `InventoryMovement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `invoice_no` to the `Invoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order_no` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `client_id` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `method` on the `Payment` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `date` to the `ProductionLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `product_id` to the `ProductionLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `ProductionLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `name` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL');

-- CreateEnum
CREATE TYPE "InventorySourceType" AS ENUM ('PRODUCTION', 'ORDER', 'MANUAL', 'TRANSFER', 'RETURN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('PROFORMA', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('RECORDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('TAX', 'SHIPPING', 'DISCOUNT', 'OTHER');

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'ADJUSTMENT';

-- DropForeignKey
ALTER TABLE "ActivityLog" DROP CONSTRAINT "ActivityLog_user_id_fkey";

-- DropForeignKey
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_item_id_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "ProductionLog" DROP CONSTRAINT "ProductionLog_client_id_fkey";

-- DropForeignKey
ALTER TABLE "ProductionLog" DROP CONSTRAINT "ProductionLog_item_id_fkey";

-- DropIndex
DROP INDEX "Client_company_id_factory_id_idx";

-- DropIndex
DROP INDEX "ClientContact_company_id_factory_id_client_id_idx";

-- DropIndex
DROP INDEX "ClientProduct_company_id_factory_id_client_id_idx";

-- DropIndex
DROP INDEX "InventoryMovement_company_id_factory_id_item_id_idx";

-- DropIndex
DROP INDEX "Invoice_company_id_factory_id_idx";

-- DropIndex
DROP INDEX "Order_company_id_factory_id_idx";

-- DropIndex
DROP INDEX "Payment_company_id_factory_id_idx";

-- DropIndex
DROP INDEX "Permission_key_key";

-- DropIndex
DROP INDEX "ProductionLog_company_id_factory_id_idx";

-- DropIndex
DROP INDEX "UserFactoryMap_user_id_factory_id_key";

-- DropIndex
DROP INDEX "UserRoleMap_user_id_role_id_key";

-- AlterTable
ALTER TABLE "ActivityLog" DROP COLUMN "ip_address",
DROP COLUMN "new_value",
DROP COLUMN "old_value",
ADD COLUMN     "factory_id" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "user_agent" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL,
ALTER COLUMN "entity_type" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "created_by",
DROP COLUMN "factory_id",
DROP COLUMN "gst_number",
DROP COLUMN "name",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "company_name" TEXT NOT NULL,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "ClientContact" DROP COLUMN "created_by",
DROP COLUMN "factory_id",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ClientProduct" DROP COLUMN "created_by",
DROP COLUMN "factory_id",
DROP COLUMN "product_name",
ADD COLUMN     "default_price" DECIMAL(15,2),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "product_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Factory" DROP COLUMN "created_by",
DROP COLUMN "location",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "InventoryMovement" DROP COLUMN "item_id",
DROP COLUMN "movement_type",
DROP COLUMN "reference",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "product_id" TEXT NOT NULL,
ADD COLUMN     "source_id" TEXT,
ADD COLUMN     "source_type" "InventorySourceType" NOT NULL,
ADD COLUMN     "type" "InventoryMovementType" NOT NULL,
ADD COLUMN     "unit_cost" DECIMAL(15,2),
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "invoice_date",
DROP COLUMN "invoice_number",
DROP COLUMN "total_amount",
ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "invoice_no" TEXT NOT NULL,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'TAX_INVOICE',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_charges" DECIMAL(15,2) NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "order_number",
DROP COLUMN "total_amount",
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "order_no" TEXT NOT NULL,
ADD COLUMN     "required_by" TIMESTAMP(3),
ADD COLUMN     "subtotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(15,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_charges" DECIMAL(15,2) NOT NULL DEFAULT 0,
ALTER COLUMN "order_date" SET DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "status",
ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "invoice_id",
DROP COLUMN "paid_on",
ADD COLUMN     "client_id" TEXT NOT NULL,
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "payment_no" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
ALTER COLUMN "factory_id" DROP NOT NULL,
DROP COLUMN "method",
ADD COLUMN     "method" "PaymentMethod" NOT NULL,
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Permission" DROP COLUMN "created_by",
DROP COLUMN "updated_at",
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProductionLog" DROP COLUMN "client_id",
DROP COLUMN "item_id",
DROP COLUMN "production_date",
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "product_id" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(15,2),
ALTER COLUMN "created_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "created_by",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "created_by",
DROP COLUMN "is_active",
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "UserFactoryMap" DROP COLUMN "updated_at";

-- AlterTable
ALTER TABLE "UserRoleMap" DROP COLUMN "updated_at";

-- DropTable
DROP TABLE "InventoryItem";

-- DropEnum
DROP TYPE "InventoryItemType";

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_jti" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissionMap" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "RolePermissionMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL,
    "pack_size" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "discount" DECIMAL(15,2),
    "line_total" DECIMAL(15,2) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCharge" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(15,2) NOT NULL,
    "unit_price" DECIMAL(15,2) NOT NULL,
    "discount" DECIMAL(15,2),
    "line_total" DECIMAL(15,2) NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCharge" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "type" "ChargeType" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceStatusHistory" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "note" TEXT,
    "meta" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReport" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT,
    "title" TEXT NOT NULL,
    "authority" TEXT,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "tags" TEXT,
    "file_url" TEXT NOT NULL,
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "meta" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCampaign" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "name" TEXT NOT NULL,
    "template_id" TEXT,
    "purpose" TEXT,
    "meta" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageRecipient" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "client_id" TEXT,
    "contact_id" TEXT,
    "to_email" TEXT,
    "to_phone" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "factory_id" TEXT,
    "client_id" TEXT,
    "order_id" TEXT,
    "invoice_id" TEXT,
    "to" TEXT NOT NULL,
    "provider" TEXT,
    "provider_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "payload" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCampaignId" TEXT,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_is_active_idx" ON "Company"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_token_jti_key" ON "UserSession"("token_jti");

-- CreateIndex
CREATE INDEX "UserSession_company_id_user_id_idx" ON "UserSession"("company_id", "user_id");

-- CreateIndex
CREATE INDEX "UserSession_company_id_revoked_at_expires_at_idx" ON "UserSession"("company_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "RolePermissionMap_company_id_role_id_idx" ON "RolePermissionMap"("company_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermissionMap_company_id_role_id_permission_id_key" ON "RolePermissionMap"("company_id", "role_id", "permission_id");

-- CreateIndex
CREATE INDEX "ProductCategory_company_id_is_active_idx" ON "ProductCategory"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_company_id_name_key" ON "ProductCategory"("company_id", "name");

-- CreateIndex
CREATE INDEX "Product_company_id_category_id_is_active_idx" ON "Product"("company_id", "category_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "Product_company_id_name_pack_size_key" ON "Product"("company_id", "name", "pack_size");

-- CreateIndex
CREATE INDEX "StockSnapshot_company_id_factory_id_as_of_date_idx" ON "StockSnapshot"("company_id", "factory_id", "as_of_date");

-- CreateIndex
CREATE UNIQUE INDEX "StockSnapshot_company_id_factory_id_product_id_as_of_date_key" ON "StockSnapshot"("company_id", "factory_id", "product_id", "as_of_date");

-- CreateIndex
CREATE INDEX "OrderItem_company_id_order_id_idx" ON "OrderItem"("company_id", "order_id");

-- CreateIndex
CREATE INDEX "OrderItem_company_id_product_id_idx" ON "OrderItem"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "OrderCharge_company_id_order_id_idx" ON "OrderCharge"("company_id", "order_id");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_company_id_order_id_created_at_idx" ON "OrderStatusHistory"("company_id", "order_id", "created_at");

-- CreateIndex
CREATE INDEX "InvoiceItem_company_id_invoice_id_idx" ON "InvoiceItem"("company_id", "invoice_id");

-- CreateIndex
CREATE INDEX "InvoiceItem_company_id_product_id_idx" ON "InvoiceItem"("company_id", "product_id");

-- CreateIndex
CREATE INDEX "InvoiceCharge_company_id_invoice_id_idx" ON "InvoiceCharge"("company_id", "invoice_id");

-- CreateIndex
CREATE INDEX "InvoiceStatusHistory_company_id_invoice_id_created_at_idx" ON "InvoiceStatusHistory"("company_id", "invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "PaymentAllocation_company_id_payment_id_idx" ON "PaymentAllocation"("company_id", "payment_id");

-- CreateIndex
CREATE INDEX "PaymentAllocation_company_id_invoice_id_idx" ON "PaymentAllocation"("company_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_company_id_payment_id_invoice_id_key" ON "PaymentAllocation"("company_id", "payment_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ComplianceReport_company_id_factory_id_valid_to_idx" ON "ComplianceReport"("company_id", "factory_id", "valid_to");

-- CreateIndex
CREATE INDEX "ComplianceReport_company_id_is_active_idx" ON "ComplianceReport"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "MessageTemplate_company_id_is_active_idx" ON "MessageTemplate"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_company_id_name_channel_key" ON "MessageTemplate"("company_id", "name", "channel");

-- CreateIndex
CREATE INDEX "MessageCampaign_company_id_factory_id_created_at_idx" ON "MessageCampaign"("company_id", "factory_id", "created_at");

-- CreateIndex
CREATE INDEX "MessageCampaign_company_id_channel_idx" ON "MessageCampaign"("company_id", "channel");

-- CreateIndex
CREATE INDEX "MessageRecipient_company_id_campaign_id_idx" ON "MessageRecipient"("company_id", "campaign_id");

-- CreateIndex
CREATE INDEX "MessageLog_company_id_channel_created_at_idx" ON "MessageLog"("company_id", "channel", "created_at");

-- CreateIndex
CREATE INDEX "MessageLog_company_id_client_id_created_at_idx" ON "MessageLog"("company_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "MessageLog_company_id_order_id_idx" ON "MessageLog"("company_id", "order_id");

-- CreateIndex
CREATE INDEX "MessageLog_company_id_invoice_id_idx" ON "MessageLog"("company_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ActivityLog_company_id_factory_id_created_at_idx" ON "ActivityLog"("company_id", "factory_id", "created_at");

-- CreateIndex
CREATE INDEX "ActivityLog_company_id_user_id_created_at_idx" ON "ActivityLog"("company_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "Client_company_id_is_active_idx" ON "Client"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "Client_company_id_company_name_key" ON "Client"("company_id", "company_name");

-- CreateIndex
CREATE INDEX "ClientContact_company_id_client_id_is_active_idx" ON "ClientContact"("company_id", "client_id", "is_active");

-- CreateIndex
CREATE INDEX "ClientProduct_company_id_product_id_idx" ON "ClientProduct"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProduct_company_id_client_id_product_id_key" ON "ClientProduct"("company_id", "client_id", "product_id");

-- CreateIndex
CREATE INDEX "Factory_company_id_is_active_idx" ON "Factory"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "Factory_company_id_name_key" ON "Factory"("company_id", "name");

-- CreateIndex
CREATE INDEX "InventoryMovement_company_id_factory_id_date_idx" ON "InventoryMovement"("company_id", "factory_id", "date");

-- CreateIndex
CREATE INDEX "InventoryMovement_company_id_factory_id_product_id_date_idx" ON "InventoryMovement"("company_id", "factory_id", "product_id", "date");

-- CreateIndex
CREATE INDEX "InventoryMovement_company_id_source_type_source_id_idx" ON "InventoryMovement"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "Invoice_company_id_factory_id_issue_date_idx" ON "Invoice"("company_id", "factory_id", "issue_date");

-- CreateIndex
CREATE INDEX "Invoice_company_id_factory_id_client_id_issue_date_idx" ON "Invoice"("company_id", "factory_id", "client_id", "issue_date");

-- CreateIndex
CREATE INDEX "Invoice_company_id_status_idx" ON "Invoice"("company_id", "status");

-- CreateIndex
CREATE INDEX "Invoice_company_id_order_id_idx" ON "Invoice"("company_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_company_id_invoice_no_key" ON "Invoice"("company_id", "invoice_no");

-- CreateIndex
CREATE INDEX "Order_company_id_factory_id_order_date_idx" ON "Order"("company_id", "factory_id", "order_date");

-- CreateIndex
CREATE INDEX "Order_company_id_factory_id_client_id_order_date_idx" ON "Order"("company_id", "factory_id", "client_id", "order_date");

-- CreateIndex
CREATE INDEX "Order_company_id_status_idx" ON "Order"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_company_id_order_no_key" ON "Order"("company_id", "order_no");

-- CreateIndex
CREATE INDEX "Payment_company_id_client_id_paid_at_idx" ON "Payment"("company_id", "client_id", "paid_at");

-- CreateIndex
CREATE INDEX "Payment_company_id_factory_id_paid_at_idx" ON "Payment"("company_id", "factory_id", "paid_at");

-- CreateIndex
CREATE INDEX "Permission_company_id_is_active_idx" ON "Permission"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_company_id_key_key" ON "Permission"("company_id", "key");

-- CreateIndex
CREATE INDEX "ProductionLog_company_id_factory_id_date_idx" ON "ProductionLog"("company_id", "factory_id", "date");

-- CreateIndex
CREATE INDEX "ProductionLog_company_id_factory_id_product_id_date_idx" ON "ProductionLog"("company_id", "factory_id", "product_id", "date");

-- CreateIndex
CREATE INDEX "Role_company_id_is_active_idx" ON "Role"("company_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "Role_company_id_name_key" ON "Role"("company_id", "name");

-- CreateIndex
CREATE INDEX "User_company_id_status_idx" ON "User"("company_id", "status");

-- CreateIndex
CREATE INDEX "User_company_id_is_admin_idx" ON "User"("company_id", "is_admin");

-- CreateIndex
CREATE INDEX "UserFactoryMap_company_id_factory_id_idx" ON "UserFactoryMap"("company_id", "factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserFactoryMap_company_id_user_id_factory_id_key" ON "UserFactoryMap"("company_id", "user_id", "factory_id");

-- CreateIndex
CREATE INDEX "UserRoleMap_company_id_user_id_idx" ON "UserRoleMap"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleMap_company_id_user_id_role_id_key" ON "UserRoleMap"("company_id", "user_id", "role_id");

-- AddForeignKey
ALTER TABLE "Factory" ADD CONSTRAINT "Factory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleMap" ADD CONSTRAINT "UserRoleMap_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissionMap" ADD CONSTRAINT "RolePermissionMap_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissionMap" ADD CONSTRAINT "RolePermissionMap_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissionMap" ADD CONSTRAINT "RolePermissionMap_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFactoryMap" ADD CONSTRAINT "UserFactoryMap_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProduct" ADD CONSTRAINT "ClientProduct_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProduct" ADD CONSTRAINT "ClientProduct_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLog" ADD CONSTRAINT "ProductionLog_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCharge" ADD CONSTRAINT "OrderCharge_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCharge" ADD CONSTRAINT "OrderCharge_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusHistory" ADD CONSTRAINT "InvoiceStatusHistory_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusHistory" ADD CONSTRAINT "InvoiceStatusHistory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReport" ADD CONSTRAINT "ComplianceReport_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCampaign" ADD CONSTRAINT "MessageCampaign_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCampaign" ADD CONSTRAINT "MessageCampaign_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRecipient" ADD CONSTRAINT "MessageRecipient_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "MessageCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_messageCampaignId_fkey" FOREIGN KEY ("messageCampaignId") REFERENCES "MessageCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
