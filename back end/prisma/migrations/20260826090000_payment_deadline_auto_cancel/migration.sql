-- 14-day payment deadline, stored per order so the backend sweep (and a
-- scheduler) can cancel unpaid orders without depending on order-read
-- traffic, plus the staff notification type for automatic cancellations.

-- Staff get notified when an order is auto-cancelled for non-payment.
-- (PostgreSQL 12+ allows ADD VALUE inside a transaction as long as the
-- new value is not used in the same transaction — it is not.)
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_AUTO_CANCELLED';

-- Each order carries its own independent deadline (checkout + 14 days).
ALTER TABLE "orders" ADD COLUMN "payment_deadline_at" TIMESTAMP(3);

-- Backfill LIVE orders so every existing order has its own deadline.
-- HISTORICAL_IMPORT orders stay NULL — legacy rows are never auto-cancelled.
UPDATE "orders"
SET "payment_deadline_at" = "created_at" + INTERVAL '14 days'
WHERE "source" = 'LIVE';

CREATE INDEX "orders_payment_deadline_at_idx" ON "orders"("payment_deadline_at");
