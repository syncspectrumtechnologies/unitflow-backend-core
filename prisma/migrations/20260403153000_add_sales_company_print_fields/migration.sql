-- Add structured invoice-print fields for SalesCompany so invoice PDFs can render
-- office/factory/branch-style company details without changing the PDF layout.
ALTER TABLE "SalesCompany"
  ADD COLUMN IF NOT EXISTS "office_address" TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_address_label" TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_address" TEXT,
  ADD COLUMN IF NOT EXISTS "tertiary_address_label" TEXT,
  ADD COLUMN IF NOT EXISTS "tertiary_address" TEXT,
  ADD COLUMN IF NOT EXISTS "fssai_no" TEXT,
  ADD COLUMN IF NOT EXISTS "state_name" TEXT,
  ADD COLUMN IF NOT EXISTS "state_code" TEXT;
