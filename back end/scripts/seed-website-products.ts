/*
 * Seeds the customer website's real product catalog (idempotent — upserts
 * by productCode). Descriptions carry the client-approved copy from the
 * website. Product codes deliberately DIFFER from the test suites'
 * fixture codes (VET-ADECTROL-1L / PS-DOM-BROWN / F1-DOM-BROWN), which
 * the suites delete and recreate on every run.
 *
 * Pricing notes:
 * - Veterinary prices are the client-supplied catalog prices.
 * - F1 prices are the standard (lower-volume) tier; volume-tier pricing
 *   (e.g. Layer ₱140 at 100+ heads) is applied by staff on the quotation
 *   via the admin Edit Order flow — the backend models one unit price.
 * - Parent Stock lines are quoted per order (₱0 here); staff price the
 *   quotation components in the admin OCQ.
 *
 * Run:  npx tsx scripts/seed-website-products.ts
 * Re-run after test-suite runs if fixtures ever collide (they should not).
 */
import { prisma } from "../src/config/database";

const CATALOG = [
  {
    productCode: "VET-ADECTROL",
    name: "Adectrol",
    category: "VETERINARY_PRODUCT",
    unit: "Supplement",
    unitPrice: 825,
    description:
      "Adectrol is a poultry tonic and electrolyte supplement available through Dominant Asia Poultry Genetics. It is offered as part of the company's veterinary product range for poultry farmers. For proper preparation, dosage, administration, and other product-specific instructions, follow the directions provided on the original product label.",
  },
  {
    productCode: "VET-GLUTA-QUAT",
    name: "Gluta-Quat",
    category: "VETERINARY_PRODUCT",
    unit: "Disinfectant",
    unitPrice: 1400,
    description:
      "Gluta-Quat is a 15% liquid disinfectant offered through Dominant Asia Poultry Genetics. The product label identifies it as having virucidal, bactericidal, and fungicidal properties. Follow the manufacturer's instructions for approved applications, dilution, handling, safety precautions, and proper use.",
  },
  {
    productCode: "VET-NUTRIZYME-P",
    name: "Nutrizyme - P",
    category: "VETERINARY_PRODUCT",
    unit: "Supplement",
    unitPrice: 1300,
    description:
      "Nutrizyme-P is a poultry supplement available through Dominant Asia Poultry Genetics. The product label identifies it as a multivitamin and amino acid supplement. For correct dosage, preparation, administration, and recommended use, follow the instructions provided by the manufacturer on the original product label.",
  },
  {
    productCode: "VET-PROGASTRO",
    name: "Progastro",
    category: "VETERINARY_PRODUCT",
    unit: "Probiotic",
    unitPrice: 1300,
    description:
      "Progastro is a probiotic product available as part of the veterinary product range of Dominant Asia Poultry Genetics. For proper dosage, preparation, administration, and recommended use, follow the instructions provided on the original product label.",
  },
  {
    productCode: "VET-CALFOSVET",
    name: "Calfosvet",
    category: "VETERINARY_PRODUCT",
    unit: "Calcium & Mineral Supplement",
    unitPrice: 850,
    description:
      "Calfosvet is a calcium, phosphorus, and vitamin supplement formulated to support healthy growth and skeletal development in poultry. Its combination of calcium, phosphorus, Vitamin D3, and Vitamin B12 helps strengthen bones, supports proper mineral absorption, and promotes the overall development and condition of the flock. For proper preparation, dosage, and administration, follow the directions provided on the original product label.",
  },
  {
    productCode: "VET-LITTER-ODOR-BUSTER",
    name: "Litter Odor Buster",
    category: "VETERINARY_PRODUCT",
    unit: "Litterbed Probiotic & Odor Control",
    unitPrice: 530,
    description:
      "Litter Odor Buster is a probiotic litter treatment designed to help control unpleasant odors in poultry houses and other livestock environments. It contains beneficial microorganisms that support the management of poultry litter and animal manure, helping maintain a cleaner and more manageable environment for the flock. For proper preparation and application, follow the directions provided on the original product label.",
  },
  {
    productCode: "VET-TRIMEDINE",
    name: "Trimedine",
    category: "VETERINARY_PRODUCT",
    unit: "Broad-Spectrum Antimicrobial",
    unitPrice: 1650,
    description:
      "Trimedine is a broad-spectrum antimicrobial containing Trimethoprim and Sulfadimidine for poultry health management. It is used to help control susceptible bacterial infections that may affect the flock and is included in poultry health programs when antimicrobial treatment is required. For proper dosage, administration, treatment duration, and other product-specific instructions, follow the original product label and veterinary guidance.",
  },
  {
    productCode: "PS-D853",
    name: "D853",
    category: "PARENT_STOCK",
    unit: "set",
    unitPrice: 0,
    description:
      "D853 is one of the Parent Stock lines available through Dominant Asia Poultry Genetics. Farmers can review the available breeding and performance information as a reference when evaluating the line for their poultry operations.",
  },
  {
    productCode: "PS-D109",
    name: "D109",
    category: "PARENT_STOCK",
    unit: "set",
    unitPrice: 0,
    description:
      "D109 is a Parent Stock line available through Dominant Asia Poultry Genetics. Farmers can review its available breeding and performance information when considering the line for their poultry operations.",
  },
  {
    productCode: "PS-D102",
    name: "D102",
    category: "PARENT_STOCK",
    unit: "set",
    unitPrice: 0,
    description:
      "D102 forms part of the Parent Stock range offered by Dominant Asia Poultry Genetics. Farmers can use the information provided on this page to review its available breeding and performance specifications prior to ordering.",
  },
  {
    productCode: "PS-D843C",
    name: "D843c",
    category: "PARENT_STOCK",
    unit: "set",
    unitPrice: 0,
    description:
      "D843c is included in the Parent Stock offerings of Dominant Asia Poultry Genetics. This page provides farmers with access to its available breeding and performance information before proceeding with an order.",
  },
  {
    productCode: "PS-D959C",
    name: "D959c",
    category: "PARENT_STOCK",
    unit: "set",
    unitPrice: 0,
    description:
      "D959c is part of the Parent Stock range offered by Dominant Asia Poultry Genetics. Farmers can review its available breeding and performance information before placing an order through DACS.",
  },
  {
    productCode: "F1-ARTISAN",
    name: "Artisan Line",
    category: "F1",
    unit: "head",
    unitPrice: 220,
    description:
      "Artisan Line is included in the First Filial range offered by Dominant Asia Poultry Genetics. The information on this page provides farmers with a reference for the available breeding and performance data associated with the line before placing an order.",
  },
  {
    productCode: "F1-INASAL",
    name: "Inasal Type",
    category: "F1",
    unit: "head",
    unitPrice: 75,
    description:
      "Inasal Type is one of the First Filial products available through Dominant Asia Poultry Genetics. Farmers can review the available breeding and performance information when considering this line for their poultry requirements.",
  },
  {
    productCode: "F1-LAYER",
    name: "Layer Type",
    category: "F1",
    unit: "head",
    unitPrice: 160,
    description:
      "Layer Type is part of the First Filial poultry range offered by Dominant Asia Poultry Genetics. This page presents available breeding and performance information to help farmers review the product before placing an order.",
  },
] as const;

async function main(): Promise<void> {
  for (const item of CATALOG) {
    await prisma.product.upsert({
      where: { productCode: item.productCode },
      update: {
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitPrice: item.unitPrice,
        description: item.description,
        isActive: true,
      },
      create: {
        productCode: item.productCode,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unitPrice: item.unitPrice,
        description: item.description,
        isActive: true,
      },
    });
    console.log(`Upserted ${item.productCode} — ${item.name}`);
  }
  const active = await prisma.product.count({ where: { isActive: true } });
  console.log(`Active products now: ${active}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
