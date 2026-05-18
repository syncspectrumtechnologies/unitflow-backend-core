-- AlterTable
-- Set default invoice status to PENDING (unpaid) for new invoices.
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'PENDING';
