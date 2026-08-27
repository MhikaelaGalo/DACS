"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { SignInRequiredDialog } from "@/components/auth/SignInRequiredDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCart } from "@/components/providers/CartProvider";
import { ROUTES } from "@/constants/routes";
import { orderHrefForProduct } from "@/services/order-entry";
import {
  fetchSeminarEligibility,
  isChickCategory,
} from "@/services/eligibility.service";
import type { Product } from "@/types/product";

// Figma: Products Page (203:29) catalog card at 0.75 scale:
// image box 401x284 -> ~301x213 (rounded 20 -> 15, shadow 20 -> 15),
// name 32 -> 24, price/category 24 -> 18, Add to Cart 85 -> 64 tall.
export function ProductCard({ product }: { product: Product }) {
  const { user, ready } = useAuth();
  const { addItem } = useCart();
  const router = useRouter();
  const detailHref = `${ROUTES.products}/${product.slug}`;
  // F1/PS cards carry an Order Now button into the existing order forms.
  const orderHref = orderHrefForProduct(product);
  const [signInOpen, setSignInOpen] = useState(false);
  // Where a successful sign-in should land: the order form (Order Now)
  // or back on the catalog (Add to Cart).
  const [signInReturnTo, setSignInReturnTo] = useState<string>(ROUTES.products);
  // PS/F1 cards show a "Seminar Required" hint until Modules 1-3 are done.
  // Chick cards default to the hint (safe direction: never flash unlocked
  // while progress loads; the initial state derives from props, so server
  // and first client render still match); the effect then clears it for
  // eligible farmers and signed-out visitors, who meet the Sign In flow at
  // ordering entry points instead.
  const [seminarLocked, setSeminarLocked] = useState(
    isChickCategory(product.category)
  );

  useEffect(() => {
    if (!ready || !user || !isChickCategory(product.category)) {
      setSeminarLocked(false);
      return;
    }
    let cancelled = false;
    fetchSeminarEligibility()
      .then((eligibility) => {
        if (!cancelled) setSeminarLocked(!eligibility.chickOrderingEligible);
      })
      .catch(() => {
        // Unknown state stays locked — the safe direction.
        if (!cancelled) setSeminarLocked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [product.category, ready, user]);

  // Auth check comes first: signed-out visitors browsing the public catalog
  // must sign in before anything is added to a cart.
  function handleAddToCart() {
    if (!user) {
      setSignInReturnTo(ROUTES.products);
      setSignInOpen(true);
      return;
    }
    addItem(product, 1);
  }

  // Order Now enters the existing order workflow with this product
  // preselected. Signed-out visitors sign in first and return straight to
  // the order form; eligibility stays with the order pages + backend.
  function handleOrderNow() {
    if (!orderHref) return;
    if (!user) {
      setSignInReturnTo(orderHref);
      setSignInOpen(true);
      return;
    }
    router.push(orderHref);
  }

  return (
    <div className="flex flex-col">
      <Link
        href={detailHref}
        className="relative block h-[213px] w-full overflow-clip rounded-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(min-width: 1280px) 301px, (min-width: 640px) 50vw, 100vw"
            className="object-contain"
          />
        ) : (
          <div className="size-full bg-[#d9d9d9]" />
        )}
      </Link>
      <div className="mt-[30px] flex items-start justify-between gap-[12px]">
        <Link
          href={detailHref}
          className="min-w-0 text-[24px] font-semibold leading-normal text-black"
        >
          {product.name}
        </Link>
        {product.price > 0 && (
          <p className="mt-[8px] whitespace-nowrap text-right text-[18px] leading-normal text-[#c00]">
            ₱{product.price.toLocaleString()}
          </p>
        )}
      </div>
      <p className="mt-[8px] text-[18px] leading-normal text-black">
        {product.unit}
      </p>
      {seminarLocked && (
        <p className="mt-[8px] flex items-center gap-[6px] text-[14px] leading-normal text-[#7d7d7d]">
          <Lock size={14} aria-hidden className="shrink-0" />
          Seminar Required
        </p>
      )}
      {product.category === "VP" && (
        <button
          type="button"
          onClick={handleAddToCart}
          className="mt-[30px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            Add to Cart
          </span>
        </button>
      )}
      {orderHref && (
        <button
          type="button"
          onClick={handleOrderNow}
          className="mt-[30px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            Order Now
          </span>
        </button>
      )}
      <SignInRequiredDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        returnTo={signInReturnTo}
      />
    </div>
  );
}
