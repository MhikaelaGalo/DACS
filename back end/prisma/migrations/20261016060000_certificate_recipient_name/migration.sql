-- Optional certificate-specific spelling correction. Existing names continue
-- to fall back to the customer profile until staff explicitly save a correction.
ALTER TABLE "certificate_requests" ADD COLUMN "recipient_name" TEXT;
