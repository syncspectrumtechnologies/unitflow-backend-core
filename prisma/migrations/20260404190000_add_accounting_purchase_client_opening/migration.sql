-- Enums
DO $$ BEGIN
  CREATE TYPE "BalanceSide" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AccountingVoucherType" AS ENUM ('OPENING', 'GENERAL', 'DEBIT_NOTE', 'CREDIT_NOTE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "BusinessSide" AS ENUM ('SALES', 'PURCHASE', 'GENERAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "opening_balance_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "opening_balance_type" "BalanceSide" NOT NULL DEFAULT 'DEBIT',
  ADD COLUMN IF NOT EXISTS "opening_balance_date" TIMESTAMP(3);

ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_method" "PaymentMethod",
  ADD COLUMN IF NOT EXISTS "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payment_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_notes" TEXT;

ALTER TABLE "Purchase"
  ALTER COLUMN "vendor_name" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "AccountingVoucher" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "factory_id" TEXT,
  "client_id" TEXT,
  "purchase_id" TEXT,
  "invoice_id" TEXT,
  "voucher_no" TEXT NOT NULL,
  "voucher_type" "AccountingVoucherType" NOT NULL,
  "business_side" "BusinessSide",
  "voucher_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "narration" TEXT,
  "particulars" TEXT,
  "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_credit" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingVoucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccountingVoucherLine" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "voucher_id" TEXT NOT NULL,
  "client_id" TEXT,
  "product_id" TEXT,
  "entry_type" "BalanceSide" NOT NULL,
  "account_name" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(15,2),
  "unit_price" DECIMAL(15,2),
  "amount" DECIMAL(15,2) NOT NULL,
  "remarks" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingVoucherLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountingVoucher_company_id_voucher_no_key"
  ON "AccountingVoucher"("company_id", "voucher_no");
CREATE INDEX IF NOT EXISTS "AccountingVoucher_company_id_voucher_type_voucher_date_idx"
  ON "AccountingVoucher"("company_id", "voucher_type", "voucher_date");
CREATE INDEX IF NOT EXISTS "AccountingVoucher_company_id_client_id_voucher_date_idx"
  ON "AccountingVoucher"("company_id", "client_id", "voucher_date");
CREATE INDEX IF NOT EXISTS "AccountingVoucher_company_id_purchase_id_idx"
  ON "AccountingVoucher"("company_id", "purchase_id");
CREATE INDEX IF NOT EXISTS "AccountingVoucher_company_id_invoice_id_idx"
  ON "AccountingVoucher"("company_id", "invoice_id");

CREATE INDEX IF NOT EXISTS "AccountingVoucherLine_company_id_voucher_id_sort_order_idx"
  ON "AccountingVoucherLine"("company_id", "voucher_id", "sort_order");
CREATE INDEX IF NOT EXISTS "AccountingVoucherLine_company_id_client_id_created_at_idx"
  ON "AccountingVoucherLine"("company_id", "client_id", "created_at");
CREATE INDEX IF NOT EXISTS "AccountingVoucherLine_company_id_product_id_created_at_idx"
  ON "AccountingVoucherLine"("company_id", "product_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "Purchase"
    ADD CONSTRAINT "Purchase_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucher"
    ADD CONSTRAINT "AccountingVoucher_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucher"
    ADD CONSTRAINT "AccountingVoucher_factory_id_fkey"
    FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucher"
    ADD CONSTRAINT "AccountingVoucher_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucher"
    ADD CONSTRAINT "AccountingVoucher_purchase_id_fkey"
    FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucher"
    ADD CONSTRAINT "AccountingVoucher_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucherLine"
    ADD CONSTRAINT "AccountingVoucherLine_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucherLine"
    ADD CONSTRAINT "AccountingVoucherLine_voucher_id_fkey"
    FOREIGN KEY ("voucher_id") REFERENCES "AccountingVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucherLine"
    ADD CONSTRAINT "AccountingVoucherLine_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "AccountingVoucherLine"
    ADD CONSTRAINT "AccountingVoucherLine_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
