"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { OrderField } from "@/components/orders/OrderField";
import { OrderReceivedModal } from "@/components/orders/OrderReceivedModal";
import { useAuth } from "@/components/providers/AuthProvider";
import { SeminarLockNotice } from "@/components/seminars/SeminarLockNotice";
import { FormCloseButton } from "@/components/ui/FormCloseButton";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import { createOrder, type CreateOrderBody } from "@/lib/api/orders";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";
import { fetchProducts } from "@/services/product.service";
import { psOrderSchema, type PsOrderFormValues } from "@/lib/validation/order";
import type { ShippingMethod } from "@/types/order";
import type { Product } from "@/types/product";

// Dropdown labels follow the Figma "Receive PS Chicks" panel (252:1121);
// values are the ShippingMethod literals stored on the order.
const SHIPPING_OPTIONS: { value: ShippingMethod; label: string }[] = [
  { value: "Air shipment", label: "Air Shipment" },
  { value: "Land Transport (Delivery)", label: "Land Transport (Delivery)" },
  {
    value: "Farm Pick Up (Rizal, Philippines)",
    label: "Farm Pick-Up (Rizal, Philippines)",
  },
];

// Breed rows in the exact order shown on the Figma frame (252:756);
// slugs resolve to real catalog products (with backend UUIDs) on load.
const PS_BREED_SLUGS = ["d853", "d109", "d102", "d959c", "d843c"];

// Figma: Parent Stocks (PS) Order Form (252:756) with the shipping dropdown
// (Receive PS Chicks 252:1121) and the Order Received dialog (252:1493),
// rendered at 0.75 scale in a 1440px container: card 1730 -> 1298, inputs
// 787/798 -> 590/599 (h 71 -> 53), breed rows 87 -> 65 tall, labels 32 -> 24
// and 24 -> 18.
export function PsOrderForm({
  preselectedSlug,
}: {
  /** Catalog slug carried by an Order Now deep link; pre-checks that breed. */
  preselectedSlug?: string | null;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [receivedOrderNumber, setReceivedOrderNumber] = useState<string | null>(
    null
  );
  const [receivedDeadline, setReceivedDeadline] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [psBreeds, setPsBreeds] = useState<Product[]>([]);

  // Live PS catalog rows in Figma display order.
  useEffect(() => {
    let cancelled = false;
    fetchProducts()
      .then((products) => {
        if (cancelled) return;
        const bySlug = new Map(products.map((p) => [p.slug, p]));
        setPsBreeds(
          PS_BREED_SLUGS.flatMap((slug) => {
            const product = bySlug.get(slug);
            return product ? [product] : [];
          })
        );
      })
      .catch(() => {
        /* Breed rows stay empty; submit reports the catalog problem. */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Set when submission is blocked by the seminar prerequisite (eligibility
  // snapshot taken at submit time, e.g. progress reset in another tab).
  const [lockNotice, setLockNotice] = useState<SeminarEligibility | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<PsOrderFormValues>({
    resolver: zodResolver(psOrderSchema),
    defaultValues: {
      purpose: "",
      shippingMethod: "Air shipment",
      firstChoiceAirport: "",
      secondChoiceAirport: "",
      airShipmentAcknowledged: false,
      receiverSameAsOwner: false,
      receiverName: "",
      receiverContactNumber: "",
      receiverFacebook: "",
      receiverMessenger: "",
      // An Order Now deep link pre-checks its breed row (unknown slugs
      // are ignored); the farmer can still adjust the selection freely.
      breeds:
        preselectedSlug && PS_BREED_SLUGS.includes(preselectedSlug)
          ? [preselectedSlug]
          : [],
    },
  });

  const shippingMethod = watch("shippingMethod");
  const acknowledged = watch("airShipmentAcknowledged");
  const sameAsOwner = watch("receiverSameAsOwner");
  const breeds = watch("breeds");
  const isAirShipment = shippingMethod === "Air shipment";

  useEffect(() => {
    if (!dropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [dropdownOpen]);

  const selectShipping = (value: ShippingMethod) => {
    setValue("shippingMethod", value, { shouldValidate: true });
    setDropdownOpen(false);
  };

  const toggleSameAsOwner = () => {
    const next = !sameAsOwner;
    setValue("receiverSameAsOwner", next);
    if (next && user) {
      setValue("receiverName", user.fullName, { shouldValidate: true });
      setValue("receiverContactNumber", user.contactNumber, {
        shouldValidate: true,
      });
    }
    if (!next) {
      setValue("receiverName", "");
      setValue("receiverContactNumber", "");
    }
  };

  const toggleBreed = (id: string) => {
    const next = breeds.includes(id)
      ? breeds.filter((b) => b !== id)
      : [...breeds, id];
    setValue("breeds", next, { shouldValidate: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    if (submitting) return;
    setServiceError(null);
    setSubmitting(true);
    try {
      // Re-check the seminar prerequisite at submit time against the
      // BACKEND's progress record (the server enforces this with a 409 on
      // Parent Stock orders regardless).
      const eligibility = await fetchSeminarEligibility();
      if (!eligibility.chickOrderingEligible) {
        setLockNotice(eligibility);
        return;
      }
      const bySlug = new Map(psBreeds.map((product) => [product.slug, product]));
      const items = values.breeds.flatMap((slug) => {
        const product = bySlug.get(slug);
        return product ? [{ productId: product.id, quantity: 1 }] : [];
      });
      if (items.length === 0) {
        setServiceError(
          "The Parent Stock catalog is unavailable right now. Please try again later."
        );
        return;
      }
      // Fields without their own backend column travel in the order's
      // instructions so staff see every answer on the quotation.
      const notes = [`Purpose of breeding: ${values.purpose.trim()}`];
      if (values.receiverMessenger.trim()) {
        notes.push(`Receiver Messenger: ${values.receiverMessenger.trim()}`);
      }
      const body: CreateOrderBody = {
        orderType: "PARENT_STOCK",
        receiverName: values.receiverName.trim(),
        receiverContact: values.receiverContactNumber.trim(),
        receiverFacebook: values.receiverFacebook.trim() || null,
        items,
      };
      if (values.shippingMethod === "Air shipment") {
        body.fulfillmentMethod = "AIRPORT";
        body.airportLocation = values.firstChoiceAirport.trim();
        if (values.secondChoiceAirport.trim()) {
          notes.push(
            `Second-choice airport: ${values.secondChoiceAirport.trim()}`
          );
        }
        notes.push("Air-shipment terms acknowledged by the customer.");
      } else if (values.shippingMethod === "Land Transport (Delivery)") {
        if (!user?.completeAddress) {
          setServiceError(
            "Delivery uses your registered address — please complete your address on the Personal Information page first."
          );
          return;
        }
        body.fulfillmentMethod = "DELIVERY";
        body.deliveryAddress = user.completeAddress;
      } else {
        body.fulfillmentMethod = "PICKUP";
        body.pickupBranch = "Farm Pick Up (Rizal, Philippines)";
      }
      body.instructions = notes.join("\n").slice(0, 1000);

      const order = await createOrder(body);
      setReceivedOrderNumber(order.orderNumber);
      setReceivedDeadline(order.paymentDeadlineAt);
    } catch (error) {
      setServiceError(
        errorMessage(
          error,
          "Unable to submit the order right now. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  });

  // Closing "Order Received!" ends the WHOLE ordering flow: dismiss the
  // confirmation, reset the submitted form (so a reopened form starts
  // clean), and return to the Order & Inquiry Forms page.
  const closeModal = () => {
    setReceivedOrderNumber(null);
    reset();
    router.push(ROUTES.forms);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-[20px] pb-[60px] pt-[40px] lg:pb-[59px] lg:pt-[64px]">
      <form
        onSubmit={onSubmit}
        noValidate
        className="relative mx-auto w-full max-w-[1298px] rounded-[15px] bg-white px-[24px] pb-[60px] pt-[60px] lg:px-[50px] lg:pb-[58px] lg:pt-[99px]"
      >
        <FormCloseButton
          fallbackHref={ROUTES.forms}
          hasUnsavedChanges={isDirty}
          ariaLabel="Exit Parent Stocks order form"
          className="left-[12px] top-[12px] lg:left-[40px] lg:top-[36px]"
        />
        <h1 className="text-center text-[24px] font-semibold leading-normal text-black">
          Parent Stocks (PS) Order Form
        </h1>

        {/* Purpose + shipping method */}
        <div className="mt-[40px] flex flex-col gap-[24px] lg:mt-[61px] lg:flex-row lg:justify-between lg:gap-0">
          <OrderField
            label="What is the purpose of your breeding?"
            showAsterisk
            containerClassName="w-full lg:w-[590px]"
            error={errors.purpose?.message}
            {...register("purpose")}
          />
          <div className="w-full lg:w-[599px]">
            <p className="flex items-start gap-[7px] text-[18px] leading-normal text-black">
              <span>How will you receive your PS chicks?</span>
              <img
                src="/figma/icon-asterisk.svg"
                alt=""
                aria-hidden
                className="h-[9px] w-[8px] -translate-y-[5px]"
              />
            </p>
            <div ref={dropdownRef} className="relative mt-[12px] lg:mt-[23px]">
              <button
                type="button"
                onClick={() => setDropdownOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                className="relative h-[56px] w-full cursor-pointer rounded-[11px] border border-[#181818] bg-white px-[30px] text-center text-[18px] leading-normal text-black lg:h-[53px]"
              >
                {SHIPPING_OPTIONS.find((o) => o.value === shippingMethod)?.label}
                <img
                  src="/figma/icon-select-arrow.svg"
                  alt=""
                  className="absolute right-[18px] top-1/2 h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                />
              </button>
              {dropdownOpen && (
                <div
                  role="listbox"
                  aria-label="How will you receive your PS chicks?"
                  className="absolute left-0 top-[calc(100%+6px)] z-10 w-full rounded-[15px] bg-white py-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:py-[30px]"
                >
                  {SHIPPING_OPTIONS.map((option, index) => (
                    <Fragment key={option.value}>
                      {index > 0 && (
                        <img
                          src="/figma/dropdown-divider.svg"
                          alt=""
                          className="mx-auto my-[20px] h-px w-[87%] lg:my-[23px] lg:w-[524px]"
                        />
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={option.value === shippingMethod}
                        onClick={() => selectShipping(option.value)}
                        className="block w-full cursor-pointer px-[16px] text-center text-[18px] leading-normal text-black"
                      >
                        {option.label}
                      </button>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Air-shipment-only details */}
        {isAirShipment && (
          <>
            <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[32px] lg:flex-row lg:justify-between lg:gap-0">
              <OrderField
                label="First-choice destination airport"
                showAsterisk
                containerClassName="w-full lg:w-[590px]"
                error={errors.firstChoiceAirport?.message}
                {...register("firstChoiceAirport")}
              />
              <OrderField
                label="Second-choice destination airport"
                showAsterisk
                containerClassName="w-full lg:w-[599px]"
                error={errors.secondChoiceAirport?.message}
                {...register("secondChoiceAirport")}
              />
            </div>
            <div className="mt-[24px] lg:mt-[32px]">
              <button
                type="button"
                onClick={() =>
                  setValue("airShipmentAcknowledged", !acknowledged, {
                    shouldValidate: true,
                  })
                }
                aria-pressed={acknowledged}
                className="flex w-full cursor-pointer items-center gap-[16px] rounded-[15px] border border-[#ffc800] bg-[#fff6d5] px-[16px] py-[16px] text-left lg:h-[66px] lg:gap-[22px] lg:px-[21px] lg:py-0"
              >
                <span className="relative block size-[28px] shrink-0 lg:size-[26px]">
                  <img
                    src="/figma/icon-radio-circle.svg"
                    alt=""
                    className="size-full"
                  />
                  {acknowledged && (
                    <span className="absolute left-1/2 top-1/2 block size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#181818]" />
                  )}
                </span>
                <span className="text-[16px] leading-normal text-black lg:text-[18px]">
                  <span className="font-bold">I understand: </span>
                  If there is no available flight to my first-choice airport, my
                  PS will automatically be sent to my second-choice airport.
                </span>
              </button>
              {errors.airShipmentAcknowledged && (
                <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
                  {errors.airShipmentAcknowledged.message}
                </p>
              )}
            </div>
          </>
        )}

        {/* Receiver information */}
        <p className="mt-[32px] text-[18px] font-bold leading-normal text-black lg:pl-[4px]">
          Receiver Information
        </p>
        <button
          type="button"
          onClick={toggleSameAsOwner}
          aria-pressed={sameAsOwner}
          className="mt-[16px] flex cursor-pointer items-center gap-[13px] lg:mt-[20px] lg:pl-[4px]"
        >
          <span className="relative block size-[28px] shrink-0 lg:size-[26px]">
            <img
              src="/figma/icon-radio-circle.svg"
              alt=""
              className="size-full"
            />
            {sameAsOwner && (
              <span className="absolute left-1/2 top-1/2 block size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#181818]" />
            )}
          </span>
          <span className="text-[16px] leading-normal text-black lg:text-[18px]">
            Receiver is same as owner
          </span>
        </button>
        <div className="mt-[16px] grid grid-cols-1 gap-[24px] sm:grid-cols-2 lg:mt-[20px] lg:grid-cols-4 lg:gap-[9px]">
          <OrderField
            label="Name of Receiver"
            showAsterisk
            inputTopClassName="mt-[12px] lg:mt-[18px]"
            error={errors.receiverName?.message}
            {...register("receiverName")}
          />
          <OrderField
            label="Receiver's Contact Number"
            type="tel"
            showAsterisk
            inputTopClassName="mt-[12px] lg:mt-[18px]"
            error={errors.receiverContactNumber?.message}
            {...register("receiverContactNumber")}
          />
          <OrderField
            label="Facebook Link"
            showAsterisk
            inputTopClassName="mt-[12px] lg:mt-[18px]"
            error={errors.receiverFacebook?.message}
            {...register("receiverFacebook")}
          />
          <OrderField
            label="Messenger Link"
            showAsterisk
            inputTopClassName="mt-[12px] lg:mt-[18px]"
            error={errors.receiverMessenger?.message}
            {...register("receiverMessenger")}
          />
        </div>

        {/* Breed order checkboxes */}
        <p className="mt-[32px] text-[18px] font-bold leading-normal text-black lg:mt-[37px] lg:pl-[4px]">
          Order
        </p>
        {errors.breeds && (
          <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
            {errors.breeds.message}
          </p>
        )}
        <div className="mt-[20px] flex flex-col gap-[16px] lg:mt-[23px] lg:gap-[20px]">
          {psBreeds.length === 0 && (
            <p className="text-[16px] leading-normal text-[#7d7d7d]">
              Loading available Parent Stock lines...
            </p>
          )}
          {psBreeds.map((product) => {
            const checked = breeds.includes(product.slug);
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => toggleBreed(product.slug)}
                aria-pressed={checked}
                className="relative flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-white drop-shadow-[0px_0px_8px_rgba(0,0,0,0.15)] lg:h-[65px]"
              >
                <span className="absolute left-[16px] top-1/2 block size-[28px] -translate-y-1/2 border border-black lg:left-[25px] lg:top-[17px] lg:translate-y-0">
                  {checked && (
                    <span className="absolute inset-[4px] block bg-[#181818]" />
                  )}
                </span>
                <span className="text-[18px] font-bold leading-normal text-black">
                  {product.name}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="mt-[40px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60 lg:mt-[59px]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            {submitting ? "Submitting..." : "Submit Order"}
          </span>
        </button>
        {serviceError && (
          <p
            role="alert"
            className="mt-[16px] text-center text-[16px] leading-normal text-[#c00]"
          >
            {serviceError}
          </p>
        )}
      </form>

      {receivedOrderNumber && (
        <OrderReceivedModal
          onClose={closeModal}
          orderNumber={receivedOrderNumber}
          paymentDeadlineAt={receivedDeadline}
        />
      )}
      {lockNotice && (
        <SeminarLockNotice
          open
          onClose={() => setLockNotice(null)}
          eligibility={lockNotice}
        />
      )}
    </div>
  );
}
