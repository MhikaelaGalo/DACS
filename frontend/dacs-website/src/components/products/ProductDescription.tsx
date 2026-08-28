"use client";

import Link from "next/link";
import { useState } from "react";
import { SignInRequiredDialog } from "@/components/auth/SignInRequiredDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCart } from "@/components/providers/CartProvider";
import { ROUTES } from "@/constants/routes";
import type { Product } from "@/types/product";

// Figma: Product Description (217:835) at 0.75 scale in the 1440px shell:
// detail card 1515 -> 1136 (rounded 50 -> 38), image box 401 -> 301,
// name 32 -> 24, body/price 24 -> 18, buttons 85 -> 64 tall.
export function ProductDescription({ product }: { product: Product }) {
  const { user } = useAuth();
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [signInOpen, setSignInOpen] = useState(false);

  // Auth check first: signed-out visitors may read everything but must sign
  // in before adding to the cart.
  function handleAddToCart() {
    if (!user) {
      setSignInOpen(true);
      return;
    }
    addItem(product, quantity);
  }

  return (
    <div className="bg-white">
      <div className="relative mx-auto max-w-[1136px] overflow-clip rounded-[38px] bg-white">
        <Link
          href={ROUTES.products}
          aria-label="Close"
          className="absolute left-[24px] top-[24px] block size-[17px] lg:left-[44px] lg:top-[37px] lg:size-[11px]"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-full" />
        </Link>
        <div className="flex flex-col px-[20px] pb-[60px] pt-[70px] lg:flex-row lg:items-start lg:pb-[82px] lg:pl-[104px] lg:pr-[56px] lg:pt-0">
          {/* Left column: image + storage */}
          <div className="w-full shrink-0 lg:w-[317px] lg:pt-[78px]">
            <div className="h-[301px] w-full border border-[#bebebe] bg-white">
              <img
                src={product.imageUrl}
                alt={product.name}
                className="size-full object-contain"
              />
            </div>
            <p className="mt-[34px] text-[15px] font-bold leading-normal text-[#7d7d7d]">
              Storage
            </p>
            <p className="mt-[17px] text-justify text-[18px] leading-normal text-black">
              {product.details?.[0]}
            </p>
          </div>

          {/* Right column: name, price, description, actions */}
          <div className="mt-[40px] min-w-0 flex-1 lg:ml-[63px] lg:mt-0 lg:pt-[95px]">
            <div className="flex items-start justify-between gap-[18px]">
              <p className="text-[24px] font-semibold leading-normal text-black">
                {product.name}
              </p>
              <p className="mt-[3px] whitespace-nowrap text-right text-[18px] font-bold leading-normal text-[#c00]">
                ₱{product.price.toLocaleString()}
              </p>
            </div>
            <p className="mt-[8px] text-[18px] leading-normal text-black">
              {product.unit}
            </p>
            <p className="mt-[32px] text-justify text-[18px] leading-normal text-black">
              {product.description}
            </p>
            {/* One row on every breakpoint: Add to Cart fills the remaining
                width beside the fixed-width quantity stepper. */}
            <div className="mt-[60px] flex items-stretch gap-[12px] lg:mt-[194px] lg:gap-[9px]">
              <button
                type="button"
                onClick={handleAddToCart}
                className="flex h-[64px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
              >
                <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                  Add to Cart
                </span>
              </button>
              <div className="flex h-[64px] w-[110px] shrink-0 items-center justify-between rounded-[11px] border border-[#181818] px-[10px]">
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="block cursor-pointer p-[2px]"
                >
                  <img src="/figma/icon-plus.svg" alt="" className="size-[11px]" />
                </button>
                <span className="text-center text-[18px] leading-normal text-[#181818]">
                  {String(quantity).padStart(2, "0")}
                </span>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="block cursor-pointer p-[2px]"
                >
                  <img
                    src="/figma/icon-minus.svg"
                    alt=""
                    className="h-[2px] w-[13px]"
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <SignInRequiredDialog
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        returnTo={`${ROUTES.products}/${product.id}`}
      />
    </div>
  );
}
