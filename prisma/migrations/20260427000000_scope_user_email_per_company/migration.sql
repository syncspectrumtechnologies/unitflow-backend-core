DROP INDEX IF EXISTS "User_email_key";

CREATE UNIQUE INDEX IF NOT EXISTS "User_company_id_email_key"
  ON "User"("company_id", "email");
