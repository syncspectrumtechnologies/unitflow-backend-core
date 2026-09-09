ALTER TABLE "CompanyPlatformConfig"
  ADD COLUMN IF NOT EXISTS "enabled_modules_json" JSONB,
  ADD COLUMN IF NOT EXISTS "feature_flags_json" JSONB;
