-- Add SalesCompany + link Orders/Invoices/Payments to a selectable billing company.
-- Also enforce 1:1 invoice per order and link payments to orders.

-- 1) SalesCompany table
CREATE TABLE "SalesCompany" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesCompany_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesCompany_company_id_name_key" ON "SalesCompany"("company_id", "name");
CREATE INDEX "SalesCompany_company_id_is_active_idx" ON "SalesCompany"("company_id", "is_active");

ALTER TABLE "SalesCompany" ADD CONSTRAINT "SalesCompany_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Order additions
ALTER TABLE "Order" ADD COLUMN "sales_company_id" TEXT;
ALTER TABLE "Order" ADD COLUMN "logistics" TEXT;

CREATE INDEX "Order_company_id_sales_company_id_idx" ON "Order"("company_id", "sales_company_id");

ALTER TABLE "Order" ADD CONSTRAINT "Order_sales_company_id_fkey" FOREIGN KEY ("sales_company_id") REFERENCES "SalesCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Invoice additions + enforce 1:1 per order
ALTER TABLE "Invoice" ADD COLUMN "sales_company_id" TEXT;

-- If there are multiple invoices linked to the same (company_id, order_id),
-- keep the most recently updated invoice and detach older ones (set order_id to NULL).
WITH ranked AS (
  SELECT "id", "company_id", "order_id",
         ROW_NUMBER() OVER (PARTITION BY "company_id", "order_id" ORDER BY "updated_at" DESC, "created_at" DESC) AS rn
  FROM "Invoice"
  WHERE "order_id" IS NOT NULL
)
UPDATE "Invoice" i
SET "order_id" = NULL
FROM ranked r
WHERE i."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX "Invoice_company_id_order_id_key" ON "Invoice"("company_id", "order_id");
CREATE INDEX "Invoice_company_id_sales_company_id_idx" ON "Invoice"("company_id", "sales_company_id");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sales_company_id_fkey" FOREIGN KEY ("sales_company_id") REFERENCES "SalesCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Payment additions: link to order + billing company
ALTER TABLE "Payment" ADD COLUMN "order_id" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sales_company_id" TEXT;

-- Backfill Payment.order_id from allocations -> invoice.order_id (best-effort)
UPDATE "Payment" p
SET "order_id" = src."order_id"
FROM (
  SELECT pa."payment_id", MAX(i."order_id") AS "order_id"
  FROM "PaymentAllocation" pa
  JOIN "Invoice" i ON i."id" = pa."invoice_id"
  WHERE pa."is_active" = true AND i."order_id" IS NOT NULL
  GROUP BY pa."payment_id"
) src
WHERE p."id" = src."payment_id" AND p."order_id" IS NULL;

CREATE INDEX "Payment_company_id_order_id_paid_at_idx" ON "Payment"("company_id", "order_id", "paid_at");
CREATE INDEX "Payment_company_id_sales_company_id_idx" ON "Payment"("company_id", "sales_company_id");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sales_company_id_fkey" FOREIGN KEY ("sales_company_id") REFERENCES "SalesCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payment.factory_id existed historically without an FK; add it as optional.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

