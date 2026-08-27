/*
 * Product catalog (read side for the admin order views). Mirrors
 * back end/src/modules/products.
 */
import { api } from "../api";

export interface ApiProduct {
  id: string;
  productCode: string;
  name: string;
  category: "PARENT_STOCK" | "F1" | "VETERINARY_PRODUCT";
  description: string | null;
  unit: string | null;
  /* Prisma Decimal — serialized as a string. */
  unitPrice: string;
  isActive: boolean;
}

export async function listProducts(): Promise<ApiProduct[]> {
  const response = await api.get<{ data: ApiProduct[] }>("/api/products");
  return response.data;
}
