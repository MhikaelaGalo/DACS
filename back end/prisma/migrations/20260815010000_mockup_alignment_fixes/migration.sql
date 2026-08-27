-- Align the schema with the approved UI mockups (Requirement 4/7 fixes).
--
-- 1. Order statuses: the mockups show "Shipped" and "Delivered" as two
--    separate customer-visible states. FULFILLED is renamed to DELIVERED
--    (preserving existing rows) and SHIPPED is added before it.
-- 2. Payment schedule: the agreed deposit/balance split and both due
--    dates vary per order, so they are stored on the order.
-- 3. Breeder monitoring: "# of Alive" and "# of Breeders Claimed" are
--    free text in practice ("D853 - 30f + 6m"), not integers.

-- 1a. Rename FULFILLED -> DELIVERED in place (keeps existing order and
--     order_status_history rows valid).
ALTER TYPE "OrderStatus" RENAME VALUE 'FULFILLED' TO 'DELIVERED';

-- 1b. Add SHIPPED. Postgres appends enum values; label order in the
--     type does not matter to the application.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';

-- 2. Per-order payment schedule.
ALTER TABLE "orders"
  ADD COLUMN "deposit_percent" INTEGER,
  ADD COLUMN "deposit_due_date" DATE,
  ADD COLUMN "balance_due_date" DATE;

-- 3. Integer counts become free text; existing numeric values are kept
--    as their text form.
ALTER TABLE "breeder_monitoring"
  ALTER COLUMN "number_alive" TYPE TEXT USING "number_alive"::TEXT,
  ALTER COLUMN "breeders_claimed" TYPE TEXT USING "breeders_claimed"::TEXT;
