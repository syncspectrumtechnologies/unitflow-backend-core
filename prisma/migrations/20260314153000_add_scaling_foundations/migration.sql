-- Optional enum for background campaign dispatch jobs
DO $$ BEGIN
  CREATE TYPE "DispatchJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Company-scoped counters for collision-safe numbering
CREATE TABLE IF NOT EXISTS "NumberSequence" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NumberSequence_company_id_key_key"
  ON "NumberSequence"("company_id", "key");
CREATE INDEX IF NOT EXISTS "NumberSequence_company_id_updated_at_idx"
  ON "NumberSequence"("company_id", "updated_at");

ALTER TABLE "NumberSequence"
  ADD CONSTRAINT "NumberSequence_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Current stock balance table for fast reads + transactional stock checks
CREATE TABLE IF NOT EXISTS "StockBalance" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "factory_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "quantity" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockBalance_company_id_factory_id_product_id_key"
  ON "StockBalance"("company_id", "factory_id", "product_id");
CREATE INDEX IF NOT EXISTS "StockBalance_company_id_factory_id_updated_at_idx"
  ON "StockBalance"("company_id", "factory_id", "updated_at");
CREATE INDEX IF NOT EXISTS "StockBalance_company_id_product_id_idx"
  ON "StockBalance"("company_id", "product_id");

ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_factory_id_fkey"
  FOREIGN KEY ("factory_id") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "StockBalance" ("id", "company_id", "factory_id", "product_id", "quantity", "created_at", "updated_at")
SELECT
  md5(im."company_id" || ':' || im."factory_id" || ':' || im."product_id") AS "id",
  im."company_id",
  im."factory_id",
  im."product_id",
  COALESCE(SUM(CASE WHEN im."type" = 'IN' THEN im."quantity" ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN im."type" = 'OUT' THEN im."quantity" ELSE 0 END), 0)
  + COALESCE(SUM(CASE WHEN im."type" = 'ADJUSTMENT' THEN im."quantity" ELSE 0 END), 0) AS "quantity",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "InventoryMovement" im
GROUP BY im."company_id", im."factory_id", im."product_id"
ON CONFLICT ("company_id", "factory_id", "product_id")
DO UPDATE SET
  "quantity" = EXCLUDED."quantity",
  "updated_at" = CURRENT_TIMESTAMP;

-- Background dispatch jobs (optional async mode)
CREATE TABLE IF NOT EXISTS "MessageDispatchJob" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "campaign_id" TEXT NOT NULL,
  "status" "DispatchJobStatus" NOT NULL DEFAULT 'QUEUED',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "total_recipients" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  CONSTRAINT "MessageDispatchJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageDispatchJob_company_id_status_created_at_idx"
  ON "MessageDispatchJob"("company_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "MessageDispatchJob_company_id_campaign_id_created_at_idx"
  ON "MessageDispatchJob"("company_id", "campaign_id", "created_at");

ALTER TABLE "MessageDispatchJob"
  ADD CONSTRAINT "MessageDispatchJob_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageDispatchJob"
  ADD CONSTRAINT "MessageDispatchJob_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "MessageCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Performance indexes aligned with growing list screens and visibility queries
CREATE INDEX IF NOT EXISTS "Product_company_id_is_active_updated_at_idx"
  ON "Product"("company_id", "is_active", "updated_at");
CREATE INDEX IF NOT EXISTS "Client_company_id_is_active_updated_at_idx"
  ON "Client"("company_id", "is_active", "updated_at");
CREATE INDEX IF NOT EXISTS "Order_company_id_is_active_order_date_idx"
  ON "Order"("company_id", "is_active", "order_date");
CREATE INDEX IF NOT EXISTS "Order_company_id_is_active_status_order_date_idx"
  ON "Order"("company_id", "is_active", "status", "order_date");
CREATE INDEX IF NOT EXISTS "OrderFulfillment_company_id_factory_id_is_active_order_id_idx"
  ON "OrderFulfillment"("company_id", "factory_id", "is_active", "order_id");
CREATE INDEX IF NOT EXISTS "Invoice_company_id_is_active_issue_date_idx"
  ON "Invoice"("company_id", "is_active", "issue_date");
CREATE INDEX IF NOT EXISTS "Invoice_company_id_is_active_status_issue_date_idx"
  ON "Invoice"("company_id", "is_active", "status", "issue_date");
CREATE INDEX IF NOT EXISTS "Payment_company_id_paid_at_idx"
  ON "Payment"("company_id", "paid_at");
CREATE INDEX IF NOT EXISTS "Purchase_company_id_is_active_updated_at_idx"
  ON "Purchase"("company_id", "is_active", "updated_at");
CREATE INDEX IF NOT EXISTS "MessageLog_company_id_status_created_at_idx"
  ON "MessageLog"("company_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "BroadcastMessage_company_id_created_at_idx"
  ON "BroadcastMessage"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_company_id_user_id_created_at_idx"
  ON "BroadcastRecipient"("company_id", "user_id", "created_at");
