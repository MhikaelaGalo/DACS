-- CreateEnum
CREATE TYPE "ImportErrorType" AS ENUM ('DUPLICATE', 'INCOMPLETE', 'INVALID');

-- AlterTable
ALTER TABLE "customer_profiles" ADD COLUMN     "source_import_id" TEXT;

-- CreateTable
CREATE TABLE "historical_files" (
    "id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "category" TEXT,
    "year" INTEGER,
    "description" TEXT,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spreadsheet_imports" (
    "id" TEXT NOT NULL,
    "historical_file_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "customers_created" INTEGER NOT NULL DEFAULT 0,
    "farms_created" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spreadsheet_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "error_type" "ImportErrorType" NOT NULL,
    "reason" TEXT NOT NULL,
    "raw_data" JSONB NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historical_files_category_idx" ON "historical_files"("category");

-- CreateIndex
CREATE INDEX "historical_files_year_idx" ON "historical_files"("year");

-- CreateIndex
CREATE INDEX "historical_files_created_at_idx" ON "historical_files"("created_at");

-- CreateIndex
CREATE INDEX "spreadsheet_imports_historical_file_id_idx" ON "spreadsheet_imports"("historical_file_id");

-- CreateIndex
CREATE INDEX "import_errors_import_id_idx" ON "import_errors"("import_id");

-- CreateIndex
CREATE INDEX "import_errors_error_type_idx" ON "import_errors"("error_type");

-- CreateIndex
CREATE INDEX "import_errors_resolved_at_idx" ON "import_errors"("resolved_at");

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "spreadsheet_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_files" ADD CONSTRAINT "historical_files_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spreadsheet_imports" ADD CONSTRAINT "spreadsheet_imports_historical_file_id_fkey" FOREIGN KEY ("historical_file_id") REFERENCES "historical_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spreadsheet_imports" ADD CONSTRAINT "spreadsheet_imports_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "spreadsheet_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
