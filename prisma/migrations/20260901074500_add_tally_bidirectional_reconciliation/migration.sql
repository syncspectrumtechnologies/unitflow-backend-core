ALTER TABLE "TallyIntegration"
ADD COLUMN "allow_tally_import" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "conflict_strategy" TEXT NOT NULL DEFAULT 'REVIEW',
ADD COLUMN "reconciliation_tolerance" DECIMAL(15,2) NOT NULL DEFAULT 1.00,
ADD COLUMN "last_inbound_sync_at" TIMESTAMP(3);

CREATE TABLE "TallyConflict" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "tally_guid" TEXT,
    "tally_name" TEXT,
    "conflict_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "unitflow_snapshot" JSONB,
    "tally_snapshot" JSONB,
    "difference" DECIMAL(15,2),
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyConflict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TallyReconciliationRun" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "from_date" TIMESTAMP(3),
    "to_date" TIMESTAMP(3),
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "missing_in_tally_count" INTEGER NOT NULL DEFAULT 0,
    "missing_in_unitflow_count" INTEGER NOT NULL DEFAULT 0,
    "ledger_conflict_count" INTEGER NOT NULL DEFAULT 0,
    "unitflow_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tally_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_difference" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tolerance" DECIMAL(15,2) NOT NULL DEFAULT 1.00,
    "source" TEXT,
    "created_by" TEXT,
    "meta" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "TallyReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TallyConflict_company_id_status_severity_idx" ON "TallyConflict"("company_id", "status", "severity");
CREATE INDEX "TallyConflict_company_id_entity_type_source_type_source_id_idx" ON "TallyConflict"("company_id", "entity_type", "source_type", "source_id");
CREATE INDEX "TallyConflict_integration_id_status_idx" ON "TallyConflict"("integration_id", "status");

CREATE INDEX "TallyReconciliationRun_company_id_started_at_idx" ON "TallyReconciliationRun"("company_id", "started_at");
CREATE INDEX "TallyReconciliationRun_company_id_status_idx" ON "TallyReconciliationRun"("company_id", "status");
CREATE INDEX "TallyReconciliationRun_integration_id_started_at_idx" ON "TallyReconciliationRun"("integration_id", "started_at");

ALTER TABLE "TallyConflict" ADD CONSTRAINT "TallyConflict_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyConflict" ADD CONSTRAINT "TallyConflict_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "TallyIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyReconciliationRun" ADD CONSTRAINT "TallyReconciliationRun_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TallyReconciliationRun" ADD CONSTRAINT "TallyReconciliationRun_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "TallyIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
