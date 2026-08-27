export type ProductCategory = "F1" | "PS" | "VP";

export interface Product {
  id: string;
  /** URL-friendly identifier; matches the /products/[id] route segment. */
  slug: string;
  name: string;
  category: ProductCategory;
  description: string;
  price: number;
  unit: string;
  /** Single source of truth for the product image, used by catalog, detail, cart, orders and receipts. */
  imageUrl: string;
  /** Ordered photo set for products with more than one approved image (first entry === imageUrl); shown by the F1/PS detail gallery. */
  galleryImageUrls?: string[];
  available: boolean;
  details?: string[];
}

/** Cart line categories: the product categories plus seminar modules. */
export type CartCategory = ProductCategory | "SEMINAR";

export interface CartItem {
  /** Line identity: the product UUID, or the seminar module UUID for
   *  seminar lines (mirrored in seminarModuleId). */
  productId: string;
  name: string;
  category: CartCategory;
  price: number;
  unit: string;
  imageUrl: string;
  quantity: number;
  /** Absent (older stored carts) = a product line. */
  itemType?: "PRODUCT" | "SEMINAR";
  /** Set on seminar lines: the backend seminar module UUID. */
  seminarModuleId?: string;
}

/** Seminar lines carry fixed quantity 1 — access is per customer. */
export function isSeminarCartItem(item: CartItem): boolean {
  return item.itemType === "SEMINAR";
}
