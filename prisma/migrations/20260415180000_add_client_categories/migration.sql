CREATE TABLE IF NOT EXISTS "ClientCategory" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientCategory_company_id_client_id_category_id_key"
  ON "ClientCategory"("company_id", "client_id", "category_id");

CREATE INDEX IF NOT EXISTS "ClientCategory_company_id_client_id_is_active_idx"
  ON "ClientCategory"("company_id", "client_id", "is_active");

CREATE INDEX IF NOT EXISTS "ClientCategory_company_id_category_id_is_active_idx"
  ON "ClientCategory"("company_id", "category_id", "is_active");

DO $$ BEGIN
  ALTER TABLE "ClientCategory"
    ADD CONSTRAINT "ClientCategory_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClientCategory"
    ADD CONSTRAINT "ClientCategory_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClientCategory"
    ADD CONSTRAINT "ClientCategory_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
