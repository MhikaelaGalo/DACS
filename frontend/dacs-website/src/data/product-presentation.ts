/*
 * Presentation metadata the backend does not store: product photos,
 * URL slugs, display unit labels and the shared veterinary "Storage"
 * paragraph (client-approved copy). Keyed by the backend productCode —
 * catalog rows are merged with this registry in product.service.ts.
 * The names/descriptions/prices themselves live in the products table
 * (seeded by back end/scripts/seed-website-products.ts).
 */

const STORAGE =
  "Store and handle according to the manufacturer's instructions provided on the original product label.";

export interface ProductPresentation {
  slug: string;
  imageUrl: string;
  /**
   * Full photo set for products with more than one approved image, in
   * display order (first entry === imageUrl). The F1/PS detail gallery
   * reads this; single-photo products omit it.
   */
  galleryImageUrls?: string[];
  /** Display label under the price on catalog cards. */
  unitLabel: string;
  details?: string[];
}

export const PRODUCT_PRESENTATION: Record<string, ProductPresentation> = {
  "VET-ADECTROL": {
    slug: "adectrol",
    imageUrl: "/images/products/adectrol.jpg",
    unitLabel: "Supplement",
    details: [STORAGE],
  },
  "VET-GLUTA-QUAT": {
    slug: "gluta-quat",
    imageUrl: "/images/products/gluta-quat.jpg",
    unitLabel: "Disinfectant",
    details: [STORAGE],
  },
  "VET-NUTRIZYME-P": {
    slug: "nutrizyme-p",
    imageUrl: "/images/products/nutrizyme-p.jpg",
    unitLabel: "Supplement",
    details: [STORAGE],
  },
  "VET-PROGASTRO": {
    slug: "progastro",
    imageUrl: "/images/products/progastro.jpg",
    unitLabel: "Probiotic",
    details: [STORAGE],
  },
  "VET-CALFOSVET": {
    slug: "calfosvet",
    imageUrl: "/images/products/calfosvet.jpg",
    unitLabel: "Calcium & Mineral Supplement",
    details: [STORAGE],
  },
  "VET-LITTER-ODOR-BUSTER": {
    slug: "litter-odor-buster",
    imageUrl: "/images/products/litter-odor-buster.jpg",
    unitLabel: "Litterbed Probiotic & Odor Control",
    details: [STORAGE],
  },
  "VET-TRIMEDINE": {
    slug: "trimedine",
    imageUrl: "/images/products/trimedine.jpg",
    unitLabel: "Broad-Spectrum Antimicrobial",
    details: [STORAGE],
  },
  "PS-D853": {
    slug: "d853",
    imageUrl: "/images/products/d853-v2.png",
    unitLabel: "Parent Stocks (PS)",
  },
  "PS-D109": {
    slug: "d109",
    imageUrl: "/images/products/d109-v2.png",
    unitLabel: "Parent Stocks (PS)",
  },
  "PS-D102": {
    slug: "d102",
    imageUrl: "/images/products/d102-v2.png",
    unitLabel: "Parent Stocks (PS)",
  },
  "PS-D843C": {
    slug: "d843c",
    imageUrl: "/images/products/d843c.jpg",
    unitLabel: "Parent Stocks (PS)",
  },
  "PS-D959C": {
    slug: "d959c",
    imageUrl: "/images/products/d959c-v2.png",
    unitLabel: "Parent Stocks (PS)",
  },
  "F1-ARTISAN": {
    slug: "artisan-line",
    imageUrl: "/images/products/f1-artisan-v1.png",
    galleryImageUrls: [
      "/images/products/f1-artisan-v1.png",
      "/images/products/f1-artisan-v2.png",
      "/images/products/f1-artisan-v3.png",
      "/images/products/f1-artisan-v4.png",
    ],
    unitLabel: "First Filial (F1)",
  },
  "F1-INASAL": {
    slug: "inasal-type",
    imageUrl: "/images/products/f1-inasal-v1.png",
    unitLabel: "First Filial (F1)",
  },
  "F1-LAYER": {
    slug: "layer-type",
    imageUrl: "/images/products/f1-layer-1st.png",
    galleryImageUrls: [
      "/images/products/f1-layer-1st.png",
      "/images/products/f1-layer-2nd.png",
    ],
    unitLabel: "First Filial (F1)",
  },
};
