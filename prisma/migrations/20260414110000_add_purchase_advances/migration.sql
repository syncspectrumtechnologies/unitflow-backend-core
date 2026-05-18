DO $$ BEGIN
  CREATE TYPE "PurchasePaymentSource" AS ENUM ('DIRECT', 'ADVANCE_APPLIED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdvanceSide" AS ENUM ('SALES', 'PURCHASE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchasePayment"
  ADD COLUMN IF NOT EXISTS "advance_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_kind" "PurchasePaymentSource" NOT NULL DEFAULT 'DIRECT';

CREATE TABLE IF NOT EXISTS "PurchaseAdvance" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "factory_id" TEXT,
  "advance_no" TEXT NOT NULL,
  "side" "AdvanceSide" NOT NULL DEFAULT 'PURCHASE',
  "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
  "amount" DECIMAL(15,2) NOT NULL,
  "remaining_amount" DECIMAL(15,2) NOT NULL,
  "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method" "PaymentMethod",
  "reference" TEXT,
  "notes" TEXT,
  "reversed_at" TIMESTAMP(3),
  "reversed_by" TEXT,
  "reversal_note" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseAdvance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseAdvance_company_id_advance_no_key" ON "PurchaseAdvance"("company_id", "advance_no");
CREATE INDEX IF NOT EXISTS "PurchaseAdvance_company_id_client_id_status_paid_at_idx" ON "PurchaseAdvance"("company_id", "client_id", "status", "paid_at");
CREATE INDEX IF NOT EXISTS "PurchaseAdvance_company_id_factory_id_paid_at_idx" ON "PurchaseAdvance"("company_id", "factory_id", "paid_at");
CREATE INDEX IF NOT EXISTS "PurchasePayment_company_id_advance_id_idx" ON "PurchasePayment"("company_id", "advance_id");

DO $$ BEGIN
  ALTER TABLE "PurchaseAdvance"
    ADD CONSTRAINT "PurchaseAdvance_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseAdvance"
    ADD CONSTRAINT "PurchaseAdvance_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseAdvance"
    ADD CONSTRAINT "PurchaseAdvance_factory_id_fkey"
    FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchasePayment"
    ADD CONSTRAINT "PurchasePayment_advance_id_fkey"
    FOREIGN KEY ("advance_id") REFERENCES "PurchaseAdvance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
