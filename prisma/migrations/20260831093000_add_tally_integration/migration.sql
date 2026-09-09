CREATE TABLE "TallyIntegration" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "tally_company_name" TEXT,
    "tally_url_hint" TEXT,
    "sync_ledgers" BOOLEAN NOT NULL DEFAULT true,
    "sync_vouchers" BOOLEAN NOT NULL DEFAULT true,
    "sync_invoices" BOOLEAN NOT NULL DEFAULT true,
    "sync_payments" BOOLEAN NOT NULL DEFAULT true,
    "auto_sync" BOOLEAN NOT NULL DEFAULT false,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 15,
    "connector_token_hash" TEXT,
    "connector_token_last4" TEXT,
    "connector_last_seen_at" TIMESTAMP(3),
    "last_sync_started_at" TIMESTAMP(3),
    "last_sync_completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallyLedgerLink" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "client_id" TEXT,
    "tally_ledger_name" TEXT NOT NULL,
    "tally_guid" TEXT,
    "tally_master_id" TEXT,
    "opening_balance" DECIMAL(15,2),
    "closing_balance" DECIMAL(15,2),
    "last_synced_at" TIMESTAMP(3),
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyLedgerLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallyVoucherLink" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "tally_voucher_guid" TEXT,
    "tally_voucher_number" TEXT,
    "tally_voucher_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyVoucherLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallySyncLog" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT,
    "direction" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source_ref" TEXT,
    "target_ref" TEXT,
    "message" TEXT,
    "meta" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "TallySyncLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TallyIntegration_company_id_key" ON "TallyIntegration"("company_id");
CREATE UNIQUE INDEX "TallyIntegration_connector_token_hash_key" ON "TallyIntegration"("connector_token_hash");
CREATE INDEX "TallyIntegration_company_id_status_idx" ON "TallyIntegration"("company_id", "status");

CREATE UNIQUE INDEX "TallyLedgerLink_company_id_client_id_key" ON "TallyLedgerLink"("company_id", "client_id");
CREATE UNIQUE INDEX "TallyLedgerLink_company_id_tally_ledger_name_key" ON "TallyLedgerLink"("company_id", "tally_ledger_name");
CREATE INDEX "TallyLedgerLink_company_id_last_synced_at_idx" ON "TallyLedgerLink"("company_id", "last_synced_at");

CREATE UNIQUE INDEX "TallyVoucherLink_company_id_source_type_source_id_key" ON "TallyVoucherLink"("company_id", "source_type", "source_id");
CREATE INDEX "TallyVoucherLink_company_id_status_idx" ON "TallyVoucherLink"("company_id", "status");
CREATE INDEX "TallyVoucherLink_company_id_last_synced_at_idx" ON "TallyVoucherLink"("company_id", "last_synced_at");

CREATE INDEX "TallySyncLog_company_id_created_at_idx" ON "TallySyncLog"("company_id", "created_at");
CREATE INDEX "TallySyncLog_company_id_status_idx" ON "TallySyncLog"("company_id", "status");

ALTER TABLE "TallyIntegration" ADD CONSTRAINT "TallyIntegration_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyLedgerLink" ADD CONSTRAINT "TallyLedgerLink_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyLedgerLink" ADD CONSTRAINT "TallyLedgerLink_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "TallyIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyLedgerLink" ADD CONSTRAINT "TallyLedgerLink_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TallyVoucherLink" ADD CONSTRAINT "TallyVoucherLink_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyVoucherLink" ADD CONSTRAINT "TallyVoucherLink_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "TallyIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallySyncLog" ADD CONSTRAINT "TallySyncLog_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallySyncLog" ADD CONSTRAINT "TallySyncLog_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "TallyIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
