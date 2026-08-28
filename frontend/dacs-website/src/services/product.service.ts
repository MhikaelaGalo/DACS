/*
 * Product catalog from the DACS backend (public GET /api/products) merged
 * with the frontend presentation registry (photos, slugs, unit labels —
 * things the products table does not store). Product.id is the backend
 * UUID, which order submission requires; the slug drives /products/[id]
 * routes.
 */
import { PRODUCT_PRESENTATION } from "@/data/product-presentation";
import type { Product, ProductCategory } from "@/types/product";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

/* GET /api/products -> data[n] (active rows only). */
interface ApiProduct {
  id: string;
  productCode: string;
  name: string;
  category: "PARENT_STOCK" | "F1" | "VETERINARY_PRODUCT";
  description: string | null;
  unit: string | null;
  /** Prisma Decimal — serialized as a string. */
  unitPrice: string | number;
  isActive: boolean;
}

const CATEGORY_MAP: Record<ApiProduct["category"], ProductCategory> = {
  VETERINARY_PRODUCT: "VP",
  PARENT_STOCK: "PS",
  F1: "F1",
};

function toProduct(row: ApiProduct): Product {
  const presentation = PRODUCT_PRESENTATION[row.productCode];
  return {
    id: row.id,
    slug: presentation?.slug ?? row.productCode.toLowerCase(),
    name: row.name,
    category: CATEGORY_MAP[row.category],
    description: row.description ?? "",
    price: Number(row.unitPrice),
    unit: presentation?.unitLabel ?? row.unit ?? "",
    // Products added by staff without frontend art fall back to the logo.
    imageUrl: presentation?.imageUrl ?? "/images/logo.png",
    ...(presentation?.galleryImageUrls
      ? { galleryImageUrls: presentation.galleryImageUrls }
      : {}),
    available: row.isActive,
    ...(presentation?.details ? { details: presentation.details } : {}),
  };
}

/**
 * The live catalog. Cached briefly (ISR) on server renders; failures
 * return an empty list — the catalog never shows fabricated products.
 */
export async function fetchProducts(): Promise<Product[]> {
  try {
    const response = await fetch(`${BASE_URL}/api/products`, {
      next: { revalidate: 120 },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { data?: ApiProduct[] };
    return (payload.data ?? []).map(toProduct);
  } catch {
    return [];
  }
}

/** Lookup by URL slug (preferred) or backend UUID. */
export async function fetchProductByIdOrSlug(
  idOrSlug: string
): Promise<Product | undefined> {
  const products = await fetchProducts();
  return products.find(
    (product) => product.slug === idOrSlug || product.id === idOrSlug
  );
}

export async function fetchProductsByCategory(
  category: ProductCategory
): Promise<Product[]> {
  const products = await fetchProducts();
  return products.filter((product) => product.category === category);
}
