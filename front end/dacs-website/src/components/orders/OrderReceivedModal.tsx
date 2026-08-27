"use client";

import { useEffect } from "react";
import { PaymentNextSteps } from "@/components/orders/PaymentInstructionsModal";

// Post-checkout dialog for the F1 / Parent Stock order forms. Evolved
// from the Figma "Order Received" card (252:1493) into the unmissable
// payment-instructions pop-up: large text for older customers, the
// email-only proof-of-payment steps, the 14-day deadline with the
// automatic-cancellation warning, and one big "I Understand" button.
// Every way of closing it (button, X or Escape) calls the same onClose,
// which ends the complete submitted-order flow.
export function OrderReceivedModal({
  onClose,
  orderNumber,
  paymentDeadlineAt,
}: {
  onClose: () => void;
  /** Real backend order reference (e.g. OQ-F1-2026-001), shown when known. */
  orderNumber?: string;
  /** The order's stored payment deadline (ISO), shown when known. */
  paymentDeadlineAt?: string | null;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-received-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(24,24,24,0.75)] px-[16px] py-[24px]"
    >
      <div className="relative max-h-full w-full max-w-[680px] overflow-y-auto rounded-[15px] bg-white px-[24px] pb-[30px] pt-[40px] sm:px-[44px] sm:pb-[36px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close order confirmation"
          className="absolute right-[20px] top-[20px] block size-[18px] cursor-pointer"
        >
          <img src="/figma/icon-modal-close.svg" alt="" className="size-full" />
        </button>
        <div className="mx-auto h-[84px] w-[85px] overflow-hidden">
          <img
            src="/figma/order-received-check.png"
            alt=""
            className="relative left-[-17.51%] top-[-10.21%] h-[120.47%] w-[127.2%] max-w-none"
          />
        </div>
        <p
          id="order-received-title"
          className="mt-[20px] text-center text-[26px] font-bold leading-[1.3] text-black sm:text-[30px]"
        >
          Order Received!
        </p>
        {orderNumber && (
          <p className="mt-[8px] text-center text-[18px] leading-normal text-[#555]">
            Order Number:{" "}
            <span className="font-bold text-black">{orderNumber}</span> — you
            can track it in your Order History.
          </p>
        )}
        <p className="mx-auto mt-[14px] max-w-[560px] text-center text-[18px] leading-[1.5] text-black">
          Your order has been received. Our team will review your submission
          and contact you within 1–3 business days.
        </p>
        <p className="mt-[22px] text-[20px] font-bold leading-normal text-[#c00]">
          What happens next
        </p>
        <div className="mt-[14px]">
          <PaymentNextSteps deadline={paymentDeadlineAt} />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-[26px] block h-[58px] w-full cursor-pointer rounded-[12px] bg-[#c00] text-[20px] font-bold text-white transition-colors hover:bg-[#a30000]"
        >
          I Understand
        </button>
      </div>
    </div>
  );
}
