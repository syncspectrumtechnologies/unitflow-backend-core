CREATE TABLE IF NOT EXISTS "PasswordResetOtp" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "requested_ip" TEXT,
  "requested_user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PasswordResetOtp_company_id_user_id_expires_at_idx"
  ON "PasswordResetOtp"("company_id", "user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "PasswordResetOtp_user_id_used_at_expires_at_idx"
  ON "PasswordResetOtp"("user_id", "used_at", "expires_at");
CREATE INDEX IF NOT EXISTS "PasswordResetOtp_company_id_email_created_at_idx"
  ON "PasswordResetOtp"("company_id", "email", "created_at");

ALTER TABLE "PasswordResetOtp"
  ADD CONSTRAINT "PasswordResetOtp_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PasswordResetOtp"
  ADD CONSTRAINT "PasswordResetOtp_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
