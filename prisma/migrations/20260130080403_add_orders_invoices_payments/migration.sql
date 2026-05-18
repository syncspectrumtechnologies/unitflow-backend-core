-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "order_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "order_id" TEXT,
    "client_id" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paid_on" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_company_id_factory_id_idx" ON "Order"("company_id", "factory_id");

-- CreateIndex
CREATE INDEX "Invoice_company_id_factory_id_idx" ON "Invoice"("company_id", "factory_id");

-- CreateIndex
CREATE INDEX "Payment_company_id_factory_id_idx" ON "Payment"("company_id", "factory_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
