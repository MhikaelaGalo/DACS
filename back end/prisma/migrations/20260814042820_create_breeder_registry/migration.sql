-- CreateEnum
CREATE TYPE "BreederEligibilityStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "BreederCertificationStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'INELIGIBLE');

-- CreateTable
CREATE TABLE "breeder_monitoring" (
    "id" TEXT NOT NULL,
    "customer_profile_id" TEXT NOT NULL,
    "farm_id" TEXT NOT NULL,
    "parent_stock_order_id" TEXT NOT NULL,
    "released_at" TIMESTAMP(3) NOT NULL,
    "eligible_at" TIMESTAMP(3) NOT NULL,
    "breeder_date" TIMESTAMP(3),
    "number_alive" INTEGER,
    "vaccination_records" TEXT,
    "feeding_management" TEXT,
    "health_management" TEXT,
    "weight_management" TEXT,
    "breeders_claimed" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breeder_monitoring_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeder_eligibility" (
    "id" TEXT NOT NULL,
    "monitoring_id" TEXT NOT NULL,
    "status" "BreederEligibilityStatus" NOT NULL DEFAULT 'PENDING',
    "eligible_at" TIMESTAMP(3) NOT NULL,
    "evaluated_by_user_id" TEXT,
    "evaluated_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breeder_eligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breeder_certifications" (
    "id" TEXT NOT NULL,
    "monitoring_id" TEXT NOT NULL,
    "certificate_number" TEXT NOT NULL,
    "status" "BreederCertificationStatus" NOT NULL DEFAULT 'PENDING',
    "certified_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "renewal_due_at" TIMESTAMP(3) NOT NULL,
    "issued_by_user_id" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breeder_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "breeder_monitoring_parent_stock_order_id_key" ON "breeder_monitoring"("parent_stock_order_id");

-- CreateIndex
CREATE INDEX "breeder_monitoring_customer_profile_id_idx" ON "breeder_monitoring"("customer_profile_id");

-- CreateIndex
CREATE INDEX "breeder_monitoring_farm_id_idx" ON "breeder_monitoring"("farm_id");

-- CreateIndex
CREATE INDEX "breeder_monitoring_eligible_at_idx" ON "breeder_monitoring"("eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "breeder_eligibility_monitoring_id_key" ON "breeder_eligibility"("monitoring_id");

-- CreateIndex
CREATE INDEX "breeder_eligibility_status_idx" ON "breeder_eligibility"("status");

-- CreateIndex
CREATE INDEX "breeder_eligibility_eligible_at_idx" ON "breeder_eligibility"("eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "breeder_certifications_certificate_number_key" ON "breeder_certifications"("certificate_number");

-- CreateIndex
CREATE INDEX "breeder_certifications_monitoring_id_idx" ON "breeder_certifications"("monitoring_id");

-- CreateIndex
CREATE INDEX "breeder_certifications_status_idx" ON "breeder_certifications"("status");

-- CreateIndex
CREATE INDEX "breeder_certifications_expires_at_idx" ON "breeder_certifications"("expires_at");

-- AddForeignKey
ALTER TABLE "breeder_monitoring" ADD CONSTRAINT "breeder_monitoring_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_monitoring" ADD CONSTRAINT "breeder_monitoring_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_monitoring" ADD CONSTRAINT "breeder_monitoring_parent_stock_order_id_fkey" FOREIGN KEY ("parent_stock_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_eligibility" ADD CONSTRAINT "breeder_eligibility_monitoring_id_fkey" FOREIGN KEY ("monitoring_id") REFERENCES "breeder_monitoring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_eligibility" ADD CONSTRAINT "breeder_eligibility_evaluated_by_user_id_fkey" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_certifications" ADD CONSTRAINT "breeder_certifications_monitoring_id_fkey" FOREIGN KEY ("monitoring_id") REFERENCES "breeder_monitoring"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breeder_certifications" ADD CONSTRAINT "breeder_certifications_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
