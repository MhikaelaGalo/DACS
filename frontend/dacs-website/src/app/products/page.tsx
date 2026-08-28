import { Footer } from "@/components/layout/Footer";
import { ProductCatalog } from "@/components/products/ProductCatalog";
import { fetchProducts } from "@/services/product.service";

// Figma: Products Page (203:29)
export default async function ProductsPage() {
  const products = await fetchProducts();
  return (
    <div className="bg-white">
      <ProductCatalog products={products} />
      <Footer />
    </div>
  );
}
