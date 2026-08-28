/*
 * Entry points into the existing DACS ordering workflow. "Order Now"
 * buttons on the catalog and product-detail pages deep-link into the
 * F1 / Parent Stock order forms with the chosen product preselected
 * (the forms read the `product` query param) — the order pages keep
 * owning auth and seminar-eligibility gating, and the backend remains
 * the authority on Parent Stock ordering (409 without Modules 1-3).
 */
import { ROUTES } from "@/constants/routes";
import type { Product } from "@/types/product";

/** Name of the query param the order forms read for preselection. */
export const ORDER_PRODUCT_PARAM = "product";

/**
 * The order-form URL for a chick product (F1 or PS), carrying the
 * product slug so the form pre-checks that line. Returns null for
 * veterinary products, which order through the cart instead.
 */
export function orderHrefForProduct(product: Product): string | null {
  if (product.category === "F1") {
    return `${ROUTES.orderF1}?${ORDER_PRODUCT_PARAM}=${encodeURIComponent(product.slug)}`;
  }
  if (product.category === "PS") {
    return `${ROUTES.orderPs}?${ORDER_PRODUCT_PARAM}=${encodeURIComponent(product.slug)}`;
  }
  return null;
}
