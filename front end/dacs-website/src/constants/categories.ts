import type { CartCategory } from "@/types/product";

// Display names for product categories, as shown on the Products catalog tabs
// and the cart / checkout line items ("Category" line in Figma 203:61, 224:1828).
// SEMINAR marks purchasable seminar-module access lines in the cart.
export const CATEGORY_LABELS: Record<CartCategory, string> = {
  VP: "Veterinary",
  F1: "First Filial (F1)",
  PS: "Parent Stocks (PS)",
  SEMINAR: "Seminar Module",
};
