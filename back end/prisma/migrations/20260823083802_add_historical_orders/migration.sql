-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('LIVE', 'HISTORICAL_IMPORT');

-- AlterEnum
ALTER TYPE "HistoricalRecordType" ADD VALUE 'ORDER';

-- AlterTable
ALTER TABLE "historical_source_records" ADD COLUMN     "order_id" TEXT,
ADD COLUMN     "order_number" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'LIVE';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'LIVE',
ALTER COLUMN "proof_original_name" DROP NOT NULL,
ALTER COLUMN "proof_mime_type" DROP NOT NULL,
ALTER COLUMN "proof_size_bytes" DROP NOT NULL,
ALTER COLUMN "proof_storage_url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "spreadsheet_imports" ADD COLUMN     "order_items_created" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "orders_created" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "payments_created" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "historical_source_records_order_id_idx" ON "historical_source_records"("order_id");

-- CreateIndex
CREATE INDEX "historical_source_records_order_number_idx" ON "historical_source_records"("order_number");

-- CreateIndex
CREATE INDEX "orders_source_idx" ON "orders"("source");

-- AddForeignKey
ALTER TABLE "historical_source_records" ADD CONSTRAINT "historical_source_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
