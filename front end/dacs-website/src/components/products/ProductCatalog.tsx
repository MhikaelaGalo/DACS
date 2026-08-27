"use client";

import { useMemo, useState } from "react";
import type { Product, ProductCategory } from "@/types/product";
import { ProductCard } from "@/components/products/ProductCard";

type TabValue = "ALL" | ProductCategory;

const TABS: { label: string; value: TabValue }[] = [
  { label: "All Products", value: "ALL" },
  { label: "Veterinary", value: "VP" },
  { label: "First Filial (F1)", value: "F1" },
  { label: "Parent Stocks (PS)", value: "PS" },
];

// Chick products display by product group: the three F1 lines first, then
// the D-Series Parent Stocks in natural alphanumeric order (D102, D109,
// D843c, D853, D959c) — not a plain alphabetical sort of the whole list.
const F1_DISPLAY_PRIORITY: Record<string, number> = {
  "Artisan Line": 1,
  "Inasal Type": 2,
  "Layer Type": 3,
};

function chickDisplayOrder(a: Product, b: Product): number {
  const priorityA = F1_DISPLAY_PRIORITY[a.name] ?? 4;
  const priorityB = F1_DISPLAY_PRIORITY[b.name] ?? 4;
  if (priorityA !== priorityB) return priorityA - priorityB;
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// Figma: Products Page (203:29), rendered at 0.75 scale in a 1440px container:
// heading 24/40 -> 18/30, tabs 24 -> 18 (underline 167 -> 125), search
// 516x49 -> 387x37, grid columns 401/52 gap -> ~301/39, row gap 89 -> 67.
export function ProductCatalog({ products }: { products: Product[] }) {
  const [tab, setTab] = useState<TabValue>("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = products.filter(
      (p) =>
        (tab === "ALL" || p.category === tab) &&
        (q === "" || p.name.toLowerCase().includes(q))
    );
    // Veterinary products keep their existing catalog order (and section);
    // chick products (F1 + PS) follow the custom group order. Copies only —
    // the source product array is never mutated.
    const veterinary = matches.filter((p) => p.category === "VP");
    const chicks = matches
      .filter((p) => p.category !== "VP")
      .sort(chickDisplayOrder);
    return [...veterinary, ...chicks];
  }, [products, tab, query]);

  return (
    <section className="mx-auto max-w-[1440px] pb-[48px] pt-[31px] lg:pb-[97px]">
      {/* Header row: heading, tabs, search */}
      <div className="flex flex-col gap-[20px] px-[20px] lg:flex-row lg:items-start lg:gap-0 lg:px-[42px]">
        <div className="shrink-0 lg:w-[248px]">
          <p className="text-[18px] font-semibold leading-normal text-[#c00]">
            Catalog
          </p>
          <p className="mt-[5px] text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
            Our Products
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-x-[32px] gap-y-[12px] lg:mt-[23px] lg:gap-x-[59px]">
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className="flex cursor-pointer flex-col items-center"
              >
                <span
                  className={`text-[16px] leading-normal lg:text-[18px] ${
                    active ? "font-bold text-[#c00]" : "font-normal text-[#767676]"
                  }`}
                >
                  {t.label}
                </span>
                {active && (
                  <span className="mt-[11px] h-px w-[125px] max-w-full bg-[#c00]" />
                )}
              </button>
            );
          })}
        </div>
        <div className="relative h-[37px] w-full max-w-[387px] lg:ml-auto lg:mt-[16px] lg:w-[387px] lg:shrink-0">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search products"
            className="size-full rounded-[11px] border border-[#181818] bg-white pl-[18px] pr-[45px] text-[15px] leading-normal text-black outline-none"
          />
          <img
            src="/figma/icon-search.svg"
            alt=""
            className="pointer-events-none absolute right-[18px] top-1/2 h-[15px] w-[14px] -translate-y-1/2"
          />
        </div>
      </div>

      {/* Product grid */}
      {filtered.length > 0 ? (
        <div className="mt-[40px] grid grid-cols-1 gap-x-[39px] gap-y-[48px] px-[20px] sm:grid-cols-2 lg:mt-[15px] lg:gap-y-[67px] lg:px-[59px] xl:grid-cols-4">
          {filtered.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        /* Empty state: an active search/filter matched nothing (products
           are a static catalog, so there is never a loading phase). */
        <div
          role="status"
          className="mt-[40px] flex flex-col items-center px-[20px] py-[48px] text-center lg:py-[72px]"
        >
          <p className="text-[22px] font-semibold leading-normal text-black lg:text-[24px]">
            No results found
          </p>
          <p className="mt-[10px] max-w-[440px] text-[15px] leading-normal text-[#767676] lg:text-[16px]">
            {query.trim() !== "" ? (
              <>
                We couldn&apos;t find any products matching{" "}
                <span className="font-semibold text-black">
                  &ldquo;{query.trim()}&rdquo;
                </span>
                . Try another product name or clear your search.
              </>
            ) : (
              <>No products are available in this category right now.</>
            )}
          </p>
          {query.trim() !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-[24px] cursor-pointer rounded-[11px] border border-[#c00] px-[28px] py-[10px] text-[15px] font-semibold leading-normal text-[#c00] transition-colors hover:bg-[#c00] hover:text-white"
            >
              Clear Search
            </button>
          )}
        </div>
      )}
    </section>
  );
}
