-- CreateEnum
CREATE TYPE "HistoricalRecordType" AS ENUM ('BREEDER_CERTIFICATE', 'SEMINAR', 'PARENT_STOCK');

-- CreateEnum
CREATE TYPE "HistoricalValidationStatus" AS ENUM ('VALID', 'PARTIAL', 'NEEDS_REVIEW', 'INVALID');

-- AlterTable
ALTER TABLE "spreadsheet_imports" ADD COLUMN     "source_records_created" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "historical_source_records" (
    "id" TEXT NOT NULL,
    "import_id" TEXT,
    "source_filename" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "record_type" "HistoricalRecordType" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "email" TEXT,
    "full_name" TEXT,
    "phone" TEXT,
    "facebook" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "pickup_location" TEXT,
    "receiver_phone" TEXT,
    "receiver_facebook" TEXT,
    "legacy_module_number" INTEGER,
    "legacy_module_raw" TEXT,
    "seminar_reference" TEXT,
    "registration_date" DATE,
    "registration_date_raw" TEXT,
    "pay_date" DATE,
    "pay_date_raw" TEXT,
    "farm_name" TEXT,
    "farm_address" TEXT,
    "breeders_acquired_at" DATE,
    "breeders_acquired_raw" TEXT,
    "breeder_heads" TEXT,
    "vaccination_records" TEXT,
    "management_records" TEXT,
    "breeders_claimed" TEXT,
    "farm_logo_value" TEXT,
    "farm_logo_url" TEXT,
    "validation_status" "HistoricalValidationStatus" NOT NULL DEFAULT 'VALID',
    "validation_messages" JSONB,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "review_notes" TEXT,
    "customer_profile_id" TEXT,
    "farm_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historical_source_records_fingerprint_key" ON "historical_source_records"("fingerprint");

-- CreateIndex
CREATE INDEX "historical_source_records_record_type_idx" ON "historical_source_records"("record_type");

-- CreateIndex
CREATE INDEX "historical_source_records_validation_status_idx" ON "historical_source_records"("validation_status");

-- CreateIndex
CREATE INDEX "historical_source_records_customer_profile_id_idx" ON "historical_source_records"("customer_profile_id");

-- CreateIndex
CREATE INDEX "historical_source_records_farm_id_idx" ON "historical_source_records"("farm_id");

-- CreateIndex
CREATE INDEX "historical_source_records_import_id_idx" ON "historical_source_records"("import_id");

-- CreateIndex
CREATE INDEX "historical_source_records_email_idx" ON "historical_source_records"("email");

-- CreateIndex
CREATE INDEX "historical_source_records_sheet_name_idx" ON "historical_source_records"("sheet_name");

-- CreateIndex
CREATE INDEX "historical_source_records_legacy_module_number_idx" ON "historical_source_records"("legacy_module_number");

-- CreateIndex
CREATE INDEX "historical_source_records_seminar_reference_idx" ON "historical_source_records"("seminar_reference");

-- CreateIndex
CREATE INDEX "historical_source_records_created_at_idx" ON "historical_source_records"("created_at");

-- AddForeignKey
ALTER TABLE "historical_source_records" ADD CONSTRAINT "historical_source_records_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "spreadsheet_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_source_records" ADD CONSTRAINT "historical_source_records_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_source_records" ADD CONSTRAINT "historical_source_records_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_source_records" ADD CONSTRAINT "historical_source_records_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
