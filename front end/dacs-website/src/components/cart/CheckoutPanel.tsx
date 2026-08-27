"use client";

// Figma: Checkout slide-over (224:1828) — order summary, delivery information
// form and payment method, with a pinned total + Place Order footer.
// Rendered at 0.75 scale: 569px wide -> 427px, section headings 32 -> 24,
// inputs 51 -> 38 tall (rounded 15 -> 11), Place Order button 85 -> 64 tall.
//
// The cart may hold products AND seminar-module access lines: the backend
// keeps one order type per order, so checkout submits one order per kind
// (products as today, seminar lines as a SEMINAR order with quantity-1
// items and no delivery). A seminar-only checkout collects contact
// details but no delivery address.
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCart } from "@/components/providers/CartProvider";
import {
  PAYMENT_PROOF_DEADLINE_DAYS,
  PAYMENT_PROOF_EMAIL,
} from "@/components/orders/PaymentDeadlineNotice";
import { CATEGORY_LABELS } from "@/constants/categories";
import { errorMessage } from "@/lib/api";
import { createOrder, type ApiOrder } from "@/lib/api/orders";
import { isSeminarCartItem } from "@/types/product";
import { getSavedDelivery, saveDelivery } from "@/services/delivery.service";
import {
  makeCheckoutSchema,
  type CheckoutFormValues,
} from "@/lib/validation/checkout";

export interface CheckoutReceipt {
  /* One order per cart kind: products and/or the seminar purchase. */
  orders: ApiOrder[];
  delivery: CheckoutFormValues;
}

const inputClass =
  "mt-[11px] h-[38px] w-full rounded-[11px] border border-[#181818] bg-transparent px-[11px] text-[12px] leading-normal text-black outline-none";
const labelClass = "block text-[12px] font-extralight leading-normal text-black";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-[5px] text-[11px] leading-normal text-[#c00]">{message}</p>
  );
}

export function CheckoutPanel({
  onClose,
  onPlaced,
}: {
  onClose: () => void;
  onPlaced: (receipt: CheckoutReceipt) => void;
}) {
  const { items, subtotal, clear, removeItem } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  // Product lines checkout as the usual product order; seminar lines
  // become one SEMINAR order (module access, quantity 1 each).
  const productItems = items.filter((item) => !isSeminarCartItem(item));
  const seminarItems = items.filter(isSeminarCartItem);
  const hasProducts = productItems.length > 0;
  // Opt-in persistence of the delivery fields for the SIGNED-IN account's
  // next checkout. Saved values prefill the form but stay editable per
  // order; edits are only stored when the box is checked on a successful
  // submission. Read once per panel open (the panel mounts on open).
  const [savedDelivery] = useState(() => getSavedDelivery());
  const [saveDeliveryInfo, setSaveDeliveryInfo] = useState(false);
  // Seminar-only checkouts are digital: no delivery address to validate.
  const schema = useMemo(() => makeCheckoutSchema(hasProducts), [hasProducts]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: savedDelivery?.fullName ?? "",
      contactNumber: savedDelivery?.contactNumber ?? "",
      email: savedDelivery?.email ?? "",
      deliveryAddress: savedDelivery?.deliveryAddress ?? "",
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    if (items.length === 0 || submitting) return;
    setServiceError(null);
    setSubmitting(true);
    try {
      // Order requests go to the DACS backend: prices are snapshotted
      // server-side (catalog products and seminar-module prices alike),
      // fees are added by staff on the quotation, and the proof of
      // payment is emailed to DACS within 14 days (no in-app upload).
      // The typed contact email has no order column, so it travels in
      // the instructions for staff to see.
      const instructions = values.email.trim()
        ? `Contact email: ${values.email.trim()}`
        : null;
      const placedOrders: ApiOrder[] = [];

      if (hasProducts) {
        const productOrder = await createOrder({
          orderType: "VETERINARY_PRODUCT",
          fulfillmentMethod: "DELIVERY",
          deliveryAddress: values.deliveryAddress.trim(),
          receiverName: values.fullName.trim(),
          receiverContact: values.contactNumber.trim(),
          instructions,
          items: productItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        });
        placedOrders.push(productOrder);
        // A later seminar-order failure must not resubmit these lines.
        productItems.forEach((item) => removeItem(item.productId));
      }

      if (seminarItems.length > 0) {
        try {
          const seminarOrder = await createOrder({
            orderType: "SEMINAR",
            receiverName: values.fullName.trim(),
            receiverContact: values.contactNumber.trim(),
            instructions,
            items: seminarItems.map((item) => ({
              seminarModuleId: item.seminarModuleId ?? item.productId,
              quantity: 1,
            })),
          });
          placedOrders.push(seminarOrder);
        } catch (error) {
          // The product order (if any) was already placed — say so
          // honestly and keep only the failed seminar lines in the cart.
          const reason = errorMessage(
            error,
            "Unable to place the seminar order right now. Please try again."
          );
          setServiceError(
            placedOrders.length > 0
              ? `Your product order ${placedOrders[0].orderNumber} was placed, but the seminar purchase failed: ${reason}`
              : reason
          );
          return;
        }
      }

      clear();
      // Only a successful, validated submission with the box checked updates
      // the account's saved delivery details.
      if (saveDeliveryInfo) {
        saveDelivery({
          fullName: values.fullName,
          contactNumber: values.contactNumber,
          email: values.email,
          deliveryAddress: values.deliveryAddress,
        });
      }
      onPlaced({ orders: placedOrders, delivery: values });
    } catch (error) {
      setServiceError(
        errorMessage(
          error,
          "Unable to place the order right now. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[427px] flex-col overflow-clip rounded-l-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]">
      <div className="relative h-[78px] shrink-0">
        <p className="absolute left-[23px] top-[35px] text-[18px] font-bold leading-normal text-black">
          Checkout
        </p>
        <button
          type="button"
          aria-label="Close checkout"
          onClick={onClose}
          className="absolute right-[23px] top-[40px] block cursor-pointer"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-[13px]" />
        </button>
      </div>
      <div className="mx-[11px] h-px shrink-0 bg-[#cfcfcf]" />
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto pb-[30px] pl-[23px] pr-[24px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="mt-[20px] text-[24px] font-semibold leading-normal text-black">
            Order Summary
          </p>
          <div className="mt-[21px]">
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
                <p className="absolute left-[100px] top-[8px] w-[191px] truncate text-[18px] leading-normal text-black">
                  {item.name}
                </p>
                <p className="absolute right-0 top-[8px] text-right text-[18px] leading-normal text-[#c00]">
                  ₱{(item.price * item.quantity).toLocaleString()}
                </p>
                <p className="absolute left-[100px] top-[32px] w-[191px] text-[12px] font-extralight leading-normal text-black">
                  {CATEGORY_LABELS[item.category]}
                </p>
                <p className="absolute left-[100px] top-[65px] w-[191px] text-[12px] font-extralight leading-normal text-black">
                  Qty. {item.quantity}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-[35px] flex items-start justify-between">
            <p className="text-[12px] font-extralight leading-normal text-black">
              Subtotal
            </p>
            <p className="text-right text-[12px] font-extralight leading-normal text-black">
              ₱{subtotal.toLocaleString()}
            </p>
          </div>
          {hasProducts && (
            <div className="mt-[14px] flex items-start justify-between">
              <p className="text-[12px] font-extralight leading-normal text-black">
                Delivery Fee
              </p>
              <p className="text-right text-[12px] font-extralight leading-normal text-black">
                Confirmed by DACS staff
              </p>
            </div>
          )}
          <div className="mt-[20px] flex items-start justify-between">
            <p className="text-[18px] font-bold leading-normal text-black">
              Total
            </p>
            <p className="text-right text-[18px] leading-normal text-[#c00]">
              ₱{subtotal.toLocaleString()}
            </p>
          </div>
          <p className="mt-[29px] text-[24px] font-semibold leading-normal text-black">
            {hasProducts ? "Delivery Information" : "Contact Information"}
          </p>
          <div className="mt-[11px] flex flex-col gap-[24px] lg:flex-row lg:gap-[32px]">
            <div className="w-full lg:w-[174px]">
              <label htmlFor="checkout-full-name" className={labelClass}>
                Full Name
              </label>
              <input
                id="checkout-full-name"
                type="text"
                autoComplete="name"
                aria-invalid={errors.fullName ? true : undefined}
                className={inputClass}
                {...register("fullName")}
              />
              <FieldError message={errors.fullName?.message} />
            </div>
            <div className="w-full lg:w-[174px]">
              <label htmlFor="checkout-contact-number" className={labelClass}>
                Contact Number
              </label>
              <input
                id="checkout-contact-number"
                type="tel"
                autoComplete="tel"
                aria-invalid={errors.contactNumber ? true : undefined}
                className={inputClass}
                {...register("contactNumber")}
              />
              <FieldError message={errors.contactNumber?.message} />
            </div>
          </div>
          <div className="mt-[11px]">
            <label htmlFor="checkout-email" className={labelClass}>
              Email Address
            </label>
            <input
              id="checkout-email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              className={inputClass}
              {...register("email")}
            />
            <FieldError message={errors.email?.message} />
          </div>
          {hasProducts && (
            <div className="mt-[11px]">
              <label htmlFor="checkout-delivery-address" className={labelClass}>
                Delivery Address
              </label>
              <input
                id="checkout-delivery-address"
                type="text"
                autoComplete="street-address"
                aria-invalid={errors.deliveryAddress ? true : undefined}
                className={inputClass}
                {...register("deliveryAddress")}
              />
              <FieldError message={errors.deliveryAddress?.message} />
            </div>
          )}
          {!hasProducts && (
            <p className="mt-[11px] text-[12px] font-light leading-normal text-[#7d7d7d]">
              Seminar modules are online — no delivery is needed. Access
              unlocks on the Seminars page once DACS verifies your payment.
            </p>
          )}
          {hasProducts && (
            <label className="mt-[18px] flex cursor-pointer items-start gap-[10px]">
              <input
                type="checkbox"
                checked={saveDeliveryInfo}
                onChange={(e) => setSaveDeliveryInfo(e.target.checked)}
                className="mt-[2px] size-[16px] shrink-0 cursor-pointer accent-[#c00]"
              />
              <span className="min-w-0">
                <span className="block text-[15px] leading-normal text-black">
                  Save this delivery information for future orders
                </span>
                <span className="mt-[2px] block text-[12px] font-light leading-normal text-[#7d7d7d]">
                  Your saved delivery details will be automatically filled in
                  during your next checkout.
                </span>
              </span>
            </label>
          )}
          <p className="mt-[29px] text-[24px] font-semibold leading-normal text-black">
            Payment
          </p>
          <p className="mt-[10px] text-[15px] leading-normal text-[#555]">
            Payment happens after DACS approves your order: the quotation
            (including the delivery fee) appears in your Order History. To
            secure your order, email your GCash or bank proof of payment to{" "}
            <a
              href={`mailto:${PAYMENT_PROOF_EMAIL}`}
              className="font-semibold underline"
            >
              {PAYMENT_PROOF_EMAIL}
            </a>{" "}
            within {PAYMENT_PROOF_DEADLINE_DAYS} days of checkout — orders
            with no recorded payment are cancelled automatically.
          </p>
        </div>
        <div className="shrink-0">
          <div className="mx-[11px] h-px bg-[#cfcfcf]" />
          <div className="pb-[32px] pl-[23px] pr-[24px]">
            <div className="flex items-start justify-between pt-[14px]">
              <p className="text-[18px] leading-normal text-[#7d7d7d]">
                Total Amount
              </p>
              <p className="text-right text-[18px] font-bold leading-normal text-black">
                ₱{subtotal.toLocaleString()}
              </p>
            </div>
            {serviceError && (
              <p
                role="alert"
                className="mt-[12px] text-[13px] leading-normal text-[#c00]"
              >
                {serviceError}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="mt-[28px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60"
            >
              <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                {submitting ? "Placing Order..." : "Place Order"}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
