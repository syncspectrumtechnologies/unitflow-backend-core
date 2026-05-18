-- Add selling price to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "price" DECIMAL(15,2) NOT NULL DEFAULT 0;
