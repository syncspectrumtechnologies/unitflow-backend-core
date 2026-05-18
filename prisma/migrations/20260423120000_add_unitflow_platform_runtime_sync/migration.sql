ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "state" TEXT,
  ADD COLUMN IF NOT EXISTS "state_code" TEXT,
  ADD COLUMN IF NOT EXISTS "is_gst_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "SalesCompany"
  ADD COLUMN IF NOT EXISTS "is_gst_enabled" BOOLEAN;

CREATE TABLE IF NOT EXISTS "CompanyPlatformConfig" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "tenant_slug" TEXT,
  "app_title" TEXT,
  "theme_color" TEXT,
  "logo_url" TEXT,
  "locale" TEXT,
  "timezone" TEXT,
  "invoice_header" TEXT,
  "invoice_footer" TEXT,
  "plan_code" TEXT,
  "billing_cycle" TEXT,
  "subscription_status" TEXT,
  "trial_ends_at" TIMESTAMP(3),
  "active_until" TIMESTAMP(3),
  "platform_last_synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CompanyPlatformConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyPlatformConfig_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyPlatformConfig_company_id_key"
  ON "CompanyPlatformConfig"("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyPlatformConfig_tenant_slug_key"
  ON "CompanyPlatformConfig"("tenant_slug");

CREATE INDEX IF NOT EXISTS "CompanyPlatformConfig_subscription_status_idx"
  ON "CompanyPlatformConfig"("subscription_status");
