
-- Add OPENING to inventory source enum if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'InventorySourceType'
      AND e.enumlabel = 'OPENING'
  ) THEN
    ALTER TYPE "InventorySourceType" ADD VALUE 'OPENING';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PurchasePayment" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "purchase_id" TEXT NOT NULL,
  "payment_no" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'RECORDED',
  "amount" DECIMAL(15,2) NOT NULL,
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
  CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchasePayment_company_id_payment_no_key"
  ON "PurchasePayment"("company_id", "payment_no");
CREATE INDEX IF NOT EXISTS "PurchasePayment_company_id_purchase_id_paid_at_idx"
  ON "PurchasePayment"("company_id", "purchase_id", "paid_at");
CREATE INDEX IF NOT EXISTS "PurchasePayment_company_id_status_paid_at_idx"
  ON "PurchasePayment"("company_id", "status", "paid_at");

DO $$ BEGIN
  ALTER TABLE "PurchasePayment"
    ADD CONSTRAINT "PurchasePayment_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchasePayment"
    ADD CONSTRAINT "PurchasePayment_purchase_id_fkey"
    FOREIGN KEY ("purchase_id") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Backfill a timeline row for legacy purchase payment snapshot data, if not already migrated.
INSERT INTO "PurchasePayment" (
  "id",
  "company_id",
  "purchase_id",
  "payment_no",
  "status",
  "amount",
  "paid_at",
  "method",
  "reference",
  "notes",
  "created_by",
  "created_at",
  "updated_at"
)
SELECT
  'legacy_purchase_payment_' || p."id" AS "id",
  p."company_id",
  p."id" AS "purchase_id",
  COALESCE(p."purchase_no", p."id") || '-LEGACY-PAY' AS "payment_no",
  'RECORDED'::"PaymentStatus" AS "status",
  p."paid_amount" AS "amount",
  COALESCE(p."paid_at", p."updated_at", p."created_at", CURRENT_TIMESTAMP) AS "paid_at",
  p."payment_method" AS "method",
  p."payment_reference" AS "reference",
  p."payment_notes" AS "notes",
  p."created_by",
  COALESCE(p."created_at", CURRENT_TIMESTAMP),
  COALESCE(p."updated_at", CURRENT_TIMESTAMP)
FROM "Purchase" p
WHERE COALESCE(p."paid_amount", 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "PurchasePayment" pp
    WHERE pp."company_id" = p."company_id"
      AND pp."purchase_id" = p."id"
  );
