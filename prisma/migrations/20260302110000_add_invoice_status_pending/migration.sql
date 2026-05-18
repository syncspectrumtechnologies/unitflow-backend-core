-- AlterEnum
-- Add new status used as the default for new TAX_INVOICE invoices.
-- IMPORTANT: this migration must not use the new enum value within the same transaction.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PENDING';
