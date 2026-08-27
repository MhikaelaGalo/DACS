-- Staff-issued DACS certificates: the physical certificate file staff
-- upload for an APPROVED request, plus the explicit issuance moment that
-- starts the 2-year validity window (valid_until = issued_at + 2 years).
--
-- certificate_file_path is relative to the PRIVATE uploads root and is
-- served only through the authenticated download endpoints — it is never
-- exposed under the public /uploads static route. VALID/EXPIRED status
-- is always derived from valid_until at read time, never stored.
-- Existing APPROVED rows deliberately stay NOT issued: their validity
-- must begin only when staff upload and issue the real certificate.

ALTER TABLE "certificate_requests"
  ADD COLUMN "certificate_file_path" TEXT,
  ADD COLUMN "certificate_file_name" TEXT,
  ADD COLUMN "certificate_file_mime_type" TEXT,
  ADD COLUMN "certificate_file_size" INTEGER,
  ADD COLUMN "certificate_file_uploaded_at" TIMESTAMP(3),
  ADD COLUMN "certificate_file_uploaded_by_user_id" TEXT,
  ADD COLUMN "issued_at" TIMESTAMP(3),
  ADD COLUMN "issued_by_user_id" TEXT,
  ADD COLUMN "valid_until" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_certificate_file_uploaded_by_user_id_fkey" FOREIGN KEY ("certificate_file_uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_requests" ADD CONSTRAINT "certificate_requests_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
