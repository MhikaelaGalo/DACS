-- Seminar module pricing + purchasable module access through the normal
-- DACS ordering workflow.
--
--  * seminar_modules.price: staff-entered access price (0 = free). Same
--    Decimal(12,2) money representation as products/orders.
--  * OrderType SEMINAR: seminar purchases are regular orders (queue,
--    approval, payments, history) with their own OQ-SEM-... numbers.
--  * order_items becomes polymorphic: item_type discriminates a catalog
--    product line from a seminar-module access line. Exactly one of
--    product_id / seminar_module_id is set, enforced by a CHECK so no
--    code path can create an ambiguous row. Existing rows are all
--    PRODUCT (the default) and keep their product_id.

-- Every existing module is free until staff set a price.
ALTER TABLE "seminar_modules" ADD COLUMN "price" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- (PostgreSQL 12+ allows ADD VALUE inside a transaction as long as the
-- new value is not used in the same transaction — it is not.)
ALTER TYPE "OrderType" ADD VALUE 'SEMINAR';

-- CreateEnum
CREATE TYPE "OrderItemType" AS ENUM ('PRODUCT', 'SEMINAR_MODULE');

-- AlterTable
ALTER TABLE "order_items"
  ADD COLUMN "item_type" "OrderItemType" NOT NULL DEFAULT 'PRODUCT',
  ADD COLUMN "seminar_module_id" TEXT,
  ALTER COLUMN "product_id" DROP NOT NULL;

-- AddForeignKey (Restrict: a module with sold access cannot be
-- hard-deleted — deleteSeminarModule archives it instead).
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seminar_module_id_fkey"
  FOREIGN KEY ("seminar_module_id") REFERENCES "seminar_modules"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "order_items_seminar_module_id_idx" ON "order_items"("seminar_module_id");

-- Exactly one link per item, matching its type.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_item_link_check" CHECK (
  ("item_type" = 'PRODUCT'        AND "product_id" IS NOT NULL AND "seminar_module_id" IS NULL) OR
  ("item_type" = 'SEMINAR_MODULE' AND "seminar_module_id" IS NOT NULL AND "product_id" IS NULL)
);
