import { notFound } from "next/navigation";
import { F1PsDescription } from "@/components/products/F1PsDescription";
import { ProductDescription } from "@/components/products/ProductDescription";
import { fetchProductByIdOrSlug } from "@/services/product.service";

// Figma: Product Description (217:835) for veterinary products,
// F1/PS Description (217:861) for F1 chicks / Parent Stock products.
export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await fetchProductByIdOrSlug(id);
  if (!product) notFound();

  return product.category === "VP" ? (
    <ProductDescription product={product} />
  ) : (
    <F1PsDescription product={product} />
  );
}
