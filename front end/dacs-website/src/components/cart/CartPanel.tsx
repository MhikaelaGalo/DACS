"use client";

// Figma: Shopping Cart slide-over (203:61) — opens from the navbar cart icon.
// The Checkout button advances to the Checkout panel (224:1828), and placing
// an order shows the Order Confirmed receipt panel (224:1916).
// Rendered at 0.75 scale: 569px wide -> 427px, header 104 -> 78, item rows
// 105 -> 79, text 24 -> 18 / 16 -> 12, checkout button 85 -> 64 tall.
import { useState } from "react";
import { useCart } from "@/components/providers/CartProvider";
import {
  CheckoutPanel,
  type CheckoutReceipt,
} from "@/components/cart/CheckoutPanel";
import { OrderConfirmedPanel } from "@/components/cart/OrderConfirmedPanel";
import { CATEGORY_LABELS } from "@/constants/categories";
import { isSeminarCartItem } from "@/types/product";

type Step = "cart" | "checkout" | "confirmed";

export function CartPanel({ onClose }: { onClose: () => void }) {
  const { items, count, subtotal, updateQuantity, removeItem } = useCart();
  const [step, setStep] = useState<Step>("cart");
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);

  if (step === "checkout") {
    return (
      <CheckoutPanel
        onClose={onClose}
        onPlaced={(placed) => {
          setReceipt(placed);
          setStep("confirmed");
        }}
      />
    );
  }

  if (step === "confirmed" && receipt) {
    return <OrderConfirmedPanel onClose={onClose} receipt={receipt} />;
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[427px] flex-col overflow-clip rounded-l-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]">
      <div className="relative h-[78px] shrink-0">
        <p className="absolute left-[23px] top-[35px] text-[18px] font-bold leading-normal text-black">
          Shopping Cart
        </p>
        <button
          type="button"
          aria-label="Close cart"
          onClick={onClose}
          className="absolute right-[23px] top-[40px] block cursor-pointer"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-[13px]" />
        </button>
      </div>
      <div className="mx-[11px] h-px shrink-0 bg-[#cfcfcf]" />
      <div className="min-h-0 flex-1 overflow-y-auto px-[23px] pb-[15px] pt-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.length === 0 && (
          <p className="pt-[18px] text-[12px] font-light leading-normal text-[#7d7d7d]">
            Your cart is empty.
          </p>
        )}
        {items.map((item, i) => (
          <div
            key={item.productId}
            className={`relative h-[79px] ${i > 0 ? "mt-[15px]" : ""}`}
          >
            <div className="absolute left-0 top-0 size-[79px] overflow-clip bg-[#d9d9d9]">
              {item.imageUrl && (
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="size-full object-cover"
                />
              )}
            </div>
            <p className="absolute left-[100px] top-[8px] w-[191px] max-w-[calc(100%-120px)] truncate text-[18px] leading-normal text-black">
              {item.name}
            </p>
            <p className="absolute left-[100px] top-[32px] w-[191px] max-w-[calc(100%-120px)] truncate text-[12px] font-extralight leading-normal text-black">
              {CATEGORY_LABELS[item.category]}
            </p>
            <p className="absolute left-[100px] top-[65px] w-[191px] text-[12px] leading-normal text-[#c00]">
              ₱{item.price.toLocaleString()}
            </p>
            <button
              type="button"
              aria-label={`Remove ${item.name} from cart`}
              onClick={() => removeItem(item.productId)}
              className="absolute right-[-1px] top-[12px] block cursor-pointer"
            >
              <img
                src="/figma/icon-trash.svg"
                alt=""
                className="h-[14px] w-[14px]"
              />
            </button>
            {isSeminarCartItem(item) ? (
              /* Seminar access is one per customer — no quantity stepper. */
              <div className="absolute bottom-0 right-0 flex h-[22px] items-center rounded-[8px] border border-[#cfcfcf] px-[10px]">
                <span className="text-[12px] leading-normal text-[#7d7d7d]">
                  Qty 1
                </span>
              </div>
            ) : (
              <div className="absolute bottom-0 right-0 flex h-[22px] w-[74px] items-center justify-between rounded-[8px] border border-[#181818] pl-[8px] pr-[7px]">
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                  className="block cursor-pointer"
                >
                  <img
                    src="/figma/icon-plus-small.svg"
                    alt=""
                    className="size-[7px]"
                  />
                </button>
                <span className="w-[22px] text-center text-[12px] leading-normal text-[#181818]">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() =>
                    updateQuantity(item.productId, Math.max(1, item.quantity - 1))
                  }
                  className="block cursor-pointer"
                >
                  <img
                    src="/figma/icon-minus-small.svg"
                    alt=""
                    className="h-[2px] w-[9px]"
                  />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0">
        <div className="mx-[11px] h-px bg-[#cfcfcf]" />
        <div className="pb-[20px] pl-[23px] pr-[24px]">
          <div className="flex items-start justify-between pt-[14px]">
            <p className="text-[18px] leading-normal text-[#7d7d7d]">
              Subtotal ({count} {count === 1 ? "item" : "items"})
            </p>
            <p className="text-right text-[18px] font-bold leading-normal text-black">
              ₱{subtotal.toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            disabled={items.length === 0}
            onClick={() => setStep("checkout")}
            className="mt-[28px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:cursor-default disabled:opacity-50"
          >
            <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
              Checkout
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
