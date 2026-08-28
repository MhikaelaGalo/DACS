"use client";

// Figma: Order Confirmed slide-over (224:1916) — shown after the backend
// accepts the order. Renders the REAL order records (numbers, snapshot
// prices, server totals); the delivery fee and payment details follow on
// the staff quotation, so no fabricated reference numbers appear here.
// A mixed checkout (products + seminar modules) places one order per
// kind — each gets its own receipt block below, and the totals row sums
// them all.
// Rendered at 0.75 scale: 569px wide -> 427px, receipt columns 337/169 ->
// 253/127, headings 32 -> 24, labels 16 -> 12, values 20 -> 15.
import { Fragment, useState } from "react";
import { MONTHS } from "@/constants/months";
import type { CheckoutReceipt } from "@/components/cart/CheckoutPanel";
import { PaymentDeadlineNotice } from "@/components/orders/PaymentDeadlineNotice";
import { PaymentInstructionsModal } from "@/components/orders/PaymentInstructionsModal";

const labelClass = "text-[12px] font-bold leading-normal text-[#7d7d7d]";
const valueClass = "text-[15px] font-semibold leading-normal text-black";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function OrderConfirmedPanel({
  onClose,
  receipt,
}: {
  onClose: () => void;
  receipt: CheckoutReceipt;
}) {
  const { orders, delivery } = receipt;

  // The payment instructions open ON TOP of the receipt right after
  // checkout — deliberately unmissable (older customers skipped the
  // notice at the bottom of this panel).
  const [showInstructions, setShowInstructions] = useState(true);

  const totalAmount = orders.reduce(
    (sum, order) => sum + Number(order.totalAmount),
    0
  );
  // One deadline notice: every order placed just now carries the same
  // 14-day window, so the first order's stamp represents the batch.
  const deadline = orders[0]?.paymentDeadlineAt ?? null;
  const orderNumbers = orders.map((order) => order.orderNumber).join(" and ");

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[427px] flex-col overflow-clip rounded-l-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]">
      <div className="relative h-[78px] shrink-0">
        <p className="absolute left-[23px] top-[35px] text-[18px] font-bold leading-normal text-black">
          Order Confirmed
        </p>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-[23px] top-[40px] block cursor-pointer"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-[13px]" />
        </button>
      </div>
      <div className="mx-[11px] h-px shrink-0 bg-[#cfcfcf]" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-[35px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className="mt-[41px] text-center text-[24px] font-semibold leading-normal text-black">
          {orders.length > 1 ? "Orders Placed" : "Order Placed"}
        </p>
        <p className="mx-auto mt-[10px] w-[315px] max-w-full px-[24px] text-center text-[18px] leading-normal text-black lg:px-0">
          Thank you for your order. Our team will review it and prepare your
          quotation.
        </p>

        {orders.map((order, orderIndex) => (
          <div
            key={order.id}
            className="grid grid-cols-[1fr_1fr] pl-[23px] pr-[24px] lg:grid-cols-[253px_127px]"
          >
            {orderIndex > 0 && (
              <div className="col-span-2 mt-[36px] h-px bg-[#cfcfcf]" />
            )}
            <p className={`${orderIndex === 0 ? "mt-[62px]" : "mt-[32px]"} ${labelClass}`}>
              Order Number
            </p>
            <p className={`${orderIndex === 0 ? "mt-[62px]" : "mt-[32px]"} ${labelClass}`}>
              Date
            </p>
            <p className={`mt-[11px] break-words pr-[12px] ${valueClass}`}>
              {order.orderNumber}
            </p>
            <p className={`mt-[11px] ${valueClass}`}>
              {formatDate(order.createdAt)}
            </p>
            <p className={`mt-[29px] ${labelClass}`}>
              {order.orderType === "SEMINAR" ? "Purchased By" : "Delivery Details"}
            </p>
            <p className={`mt-[29px] ${labelClass}`}>Sold By</p>
            <p className={`mt-[11px] break-words pr-[12px] ${valueClass}`}>
              {delivery.fullName}
            </p>
            <p className={`mt-[11px] ${valueClass}`}>
              Dominant Asia Poultry Genetics
            </p>
            <div className="mt-[16px] pr-[12px] text-[12px] leading-normal text-[#7d7d7d]">
              {order.orderType === "SEMINAR" ? (
                <p className="break-words">
                  Online seminar access — unlocks after payment verification
                </p>
              ) : (
                <p className="break-words">{delivery.deliveryAddress}</p>
              )}
              <p className="mt-[14px] break-words">{delivery.contactNumber}</p>
            </div>
            <p className="mt-[11px] whitespace-pre-line text-[12px] leading-normal text-[#7d7d7d]">
              {"Rizal, Philippines\n+63 917 123 4567"}
            </p>
            <p className={`mt-[44px] ${labelClass}`}>Item Description</p>
            <p className={`mt-[44px] ${labelClass}`}>Quantity</p>
            {order.items.map((item, i) => (
              <Fragment key={item.id}>
                <p
                  className={`${i === 0 ? "mt-[11px]" : "mt-[15px]"} break-words pr-[12px] ${valueClass}`}
                >
                  {item.productNameSnapshot}
                </p>
                <p className={`${i === 0 ? "mt-[11px]" : "mt-[15px]"} ${valueClass}`}>
                  {item.quantity}
                </p>
                <p className="mt-[16px] text-[12px] font-extralight leading-normal text-black">
                  ₱{Number(item.unitPriceSnapshot).toLocaleString()}
                  {item.itemType === "SEMINAR_MODULE" ? " — Seminar Module" : " each"}
                </p>
                <span />
              </Fragment>
            ))}
            <p className={`mt-[41px] ${labelClass}`}>Subtotal</p>
            <p className="mt-[41px] text-[12px] leading-normal text-[#7d7d7d]">
              ₱{Number(order.subtotal).toLocaleString()}
            </p>
            {order.orderType !== "SEMINAR" && (
              <>
                <p className={`mt-[11px] ${labelClass}`}>Delivery Fee</p>
                <p className="mt-[11px] text-[12px] leading-normal text-[#7d7d7d]">
                  {Number(order.feeTotal) > 0
                    ? `₱${Number(order.feeTotal).toLocaleString()}`
                    : "To be confirmed"}
                </p>
              </>
            )}
          </div>
        ))}

        <div className="mx-[11px] mt-[23px] h-px bg-[#cfcfcf]" />
        <div className="flex items-start justify-between pl-[23px] pr-[24px] pt-[15px]">
          <p className="text-[18px] font-bold leading-normal text-black">
            Total Amount
          </p>
          <p className="text-right text-[18px] leading-normal text-[#c00]">
            ₱{totalAmount.toLocaleString()}
          </p>
        </div>
        <div className="pl-[23px] pr-[24px]">
          <p className={`mt-[29px] ${labelClass}`}>What happens next</p>
          <p className="mt-[11px] text-[12px] leading-normal text-[#7d7d7d]">
            Our team reviews your order and confirms the quotation. To
            secure your order, email your proof of payment to DACS — proof
            of payment is accepted by email only.
          </p>
          <PaymentDeadlineNotice className="mt-[16px]" deadline={deadline} />
        </div>
      </div>
      {showInstructions && (
        <PaymentInstructionsModal
          orderNumber={orderNumbers}
          deadline={deadline}
          onClose={() => setShowInstructions(false)}
        />
      )}
    </div>
  );
}
