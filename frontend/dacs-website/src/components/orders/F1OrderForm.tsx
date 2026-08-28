"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { OrderReceivedModal } from "@/components/orders/OrderReceivedModal";
import { useAuth } from "@/components/providers/AuthProvider";
import { SeminarLockNotice } from "@/components/seminars/SeminarLockNotice";
import { FormCloseButton } from "@/components/ui/FormCloseButton";
import { MONTHS } from "@/constants/months";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import { createOrder } from "@/lib/api/orders";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";
import { fetchProducts } from "@/services/product.service";
import {
  f1OrderSchema,
  type F1OrderFormValues,
  type F1ScheduleOption,
} from "@/lib/validation/order";

// Month dropdown options (Figma: When need F1 255:2400) laid out as a uniform
// grid — 5 equal columns at desktop, 4 at tablet, 3 at mobile — in calendar
// order with "Other" as the final option. Figma erratum: the frame swaps
// February before January, but the client explicitly specified "January up to
// December", so calendar order is used.
const SCHEDULE_OPTIONS: F1ScheduleOption[] = [
  ...(MONTHS as readonly F1ScheduleOption[]),
  "Other",
];

interface F1CheckRowProps {
  label: string;
  labelClassName: string;
  checked: boolean;
  onToggle: () => void;
  className?: string;
}

// Figma: bordered #5c5c5c 54px -> 41px row with a 27px -> 20px square checkbox
// and a centered label.
function F1CheckRow({
  label,
  labelClassName,
  checked,
  onToggle,
  className = "",
}: F1CheckRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`relative flex h-[44px] w-full cursor-pointer items-center justify-center border border-[#5c5c5c] bg-white lg:h-[41px] ${className}`}
    >
      <span className="absolute left-[14px] top-1/2 block size-[22px] -translate-y-1/2 border border-black lg:left-[11px] lg:size-[20px]">
        {checked && (
          <span className="absolute inset-[3px] block bg-[#181818]" />
        )}
      </span>
      <span className={labelClassName}>{label}</span>
    </button>
  );
}

interface F1AmountFieldProps extends React.ComponentPropsWithRef<"input"> {
  error?: string;
  containerClassName?: string;
  /** Underline width at desktop (364 -> 273px left column, 359 -> 269px right column). */
  inputWidthClassName?: string;
}

// Figma: "Amount" label with an underlined free-write field to its right.
function F1AmountField({
  error,
  containerClassName = "",
  inputWidthClassName = "lg:w-[273px]",
  id,
  ...inputProps
}: F1AmountFieldProps) {
  const inputId = id ?? (inputProps.name ? `order-${inputProps.name}` : undefined);

  return (
    <div className={containerClassName}>
      <div className="flex items-end gap-[24px] lg:gap-0">
        <label
          htmlFor={inputId}
          className="shrink-0 text-[18px] leading-normal text-black lg:w-[241px]"
        >
          Amount
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          placeholder="Text here..."
          aria-invalid={error ? true : undefined}
          className={`h-[26px] w-full border-b border-black bg-transparent text-[16px] leading-normal text-black outline-none placeholder:italic placeholder:text-black lg:h-[20px] lg:text-[12px] ${inputWidthClassName}`}
          {...inputProps}
        />
      </div>
      {error && (
        <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}

const bulletListClassName =
  "mt-[24px] list-disc text-justify text-[16px] leading-[28px] text-black lg:mt-[27px] lg:leading-[30px] lg:text-[18px]";
const bulletClassName = "ml-[24px] lg:ml-[27px]";
const nestedBulletClassName = "ml-[48px] lg:ml-[54px]";
const priceBulletClassName = "ml-[24px] font-bold text-[#c00] lg:ml-[27px]";

// Figma: First Filial Generation (F1) Order Form (450:1569 "Other" state,
// 255:3697 month state) with the month dropdown (When need F1 255:2400)
// and the Order Received dialog (252:1493), rendered at 0.75 scale in a
// 1440px container: card 1737 -> 1303, columns 685/680 -> 514/510, month
// dropdown 71 -> 53 tall, text 40 -> 30, 32 -> 24, 24 -> 18, 20 -> 15.
/**
 * Maps a chosen month name to the backend's dateNeeded (YYYY-MM-DD):
 * the first day of that month's next occurrence.
 */
function monthToDateNeeded(month: string): string | null {
  const index = MONTHS.indexOf(month as (typeof MONTHS)[number]);
  if (index === -1) return null;
  const now = new Date();
  const year = index < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

export function F1OrderForm({
  preselectedSlug,
}: {
  /** Catalog slug carried by an Order Now deep link; pre-checks that line. */
  preselectedSlug?: string | null;
}) {
  const { user } = useAuth();
  const [monthOpen, setMonthOpen] = useState(false);
  const [receivedOrderNumber, setReceivedOrderNumber] = useState<string | null>(
    null
  );
  const [receivedDeadline, setReceivedDeadline] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  // Set when submission is blocked by the seminar prerequisite (eligibility
  // snapshot taken at submit time, e.g. progress reset in another tab).
  const [lockNotice, setLockNotice] = useState<SeminarEligibility | null>(null);
  const monthRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<F1OrderFormValues>({
    resolver: zodResolver(f1OrderSchema),
    defaultValues: {
      // An Order Now deep link pre-checks its line; the farmer still
      // reviews the copy and types the amount before submitting.
      layerSelected: preselectedSlug === "layer-type",
      layerAmount: "",
      inasalSelected: preselectedSlug === "inasal-type",
      inasalAmount: "",
      artisanSelected: preselectedSlug === "artisan-line",
      artisanAmount: "",
      neededMonth: "January",
      otherSchedule: "",
    },
  });

  const layerSelected = watch("layerSelected");
  const inasalSelected = watch("inasalSelected");
  const artisanSelected = watch("artisanSelected");
  const neededMonth = watch("neededMonth");

  useEffect(() => {
    if (!monthOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!monthRef.current?.contains(event.target as Node)) {
        setMonthOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [monthOpen]);

  const selectSchedule = (value: F1ScheduleOption) => {
    setValue("neededMonth", value, { shouldValidate: true });
    setMonthOpen(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    if (submitting) return;
    setServiceError(null);
    setSubmitting(true);
    try {
      // Re-check the seminar prerequisite at submit time against the
      // BACKEND's progress record — the same data the server gate uses.
      const eligibility = await fetchSeminarEligibility();
      if (!eligibility.chickOrderingEligible) {
        setLockNotice(eligibility);
        return;
      }
      // Resolve the three F1 lines to real catalog products by slug.
      const products = await fetchProducts();
      const bySlug = new Map(products.map((product) => [product.slug, product]));
      const lines = [
        { selected: values.layerSelected, amount: values.layerAmount, slug: "layer-type" },
        { selected: values.inasalSelected, amount: values.inasalAmount, slug: "inasal-type" },
        { selected: values.artisanSelected, amount: values.artisanAmount, slug: "artisan-line" },
      ];
      const items = lines.flatMap((line) => {
        if (!line.selected) return [];
        const product = bySlug.get(line.slug);
        if (!product) return [];
        return [{ productId: product.id, quantity: Number(line.amount) }];
      });
      if (items.length === 0) {
        setServiceError(
          "The F1 catalog is unavailable right now. Please try again later."
        );
        return;
      }
      // The chosen month becomes dateNeeded (first of that month); an
      // "Other" answer travels in the order instructions. Volume-tier
      // per-head pricing (e.g. Layer ₱140 at 100+ heads) is applied by
      // DACS staff on the quotation they send back.
      const order = await createOrder({
        orderType: "F1",
        dateNeeded:
          values.neededMonth === "Other"
            ? null
            : monthToDateNeeded(values.neededMonth),
        instructions:
          values.neededMonth === "Other"
            ? `Preferred order schedule: ${values.otherSchedule.trim()}`
            : null,
        items,
      });
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
  // confirmation, reset the submitted form (breed selections, amounts and
  // the month choice included), and return to the Order & Inquiry Forms page.
  const closeModal = () => {
    setReceivedOrderNumber(null);
    reset();
    router.push(ROUTES.forms);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-[20px] pb-[60px] pt-[40px] lg:pb-[78px] lg:pt-[79px]">
      <form
        onSubmit={onSubmit}
        noValidate
        className="relative mx-auto w-full max-w-[1303px] rounded-[15px] bg-white px-[24px] pb-[60px] pt-[60px] lg:pb-[70px] lg:pl-[110px] lg:pr-[110px] lg:pt-[108px]"
      >
        <FormCloseButton
          fallbackHref={ROUTES.forms}
          hasUnsavedChanges={isDirty}
          ariaLabel="Exit F1 order form"
          className="left-[12px] top-[12px] lg:left-[40px] lg:top-[36px]"
        />
        <h1 className="text-center text-[28px] font-semibold leading-normal text-black lg:text-[30px]">
          First Filial Generation (F1) Order Form
        </h1>
        <p className="mt-[40px] text-[24px] font-semibold leading-normal text-black lg:mt-[53px]">
          READ BEFORE ORDERING
        </p>

        {/* Layer Type / Inasal Meat Type */}
        <div className="mt-[32px] flex flex-col gap-[48px] lg:mt-[35px] lg:flex-row lg:justify-between lg:gap-0">
          <section className="w-full lg:w-[514px]">
            <p className="text-[18px] font-bold leading-normal text-black">
              For F1 Layer Type:
            </p>
            <ul className={`${bulletListClassName} lg:w-[509px]`}>
              <li className={bulletClassName}>
                For table egg production, pre-selected females
              </li>
              <li className={bulletClassName}>
                Mixed colors of egg shell, mostly brown &amp; cream
              </li>
              <li className={nestedBulletClassName}>
                Start of egg production at approximately 4.5 months
              </li>
              <li className={nestedBulletClassName}>290-300 eggs per cycle</li>
              <li className={bulletClassName}>
                Dominant CZ breed lines, released at 1-3 days old
              </li>
              <li className={bulletClassName}>
                Vaccinated against HVT, ND, IBD at day 1
              </li>
              <li className={nestedBulletClassName}>
                Suitable for cage-free, free-range &amp; organic production
              </li>
              <li className={bulletClassName}>
                With veterinary health certificate
              </li>
              <li className={nestedBulletClassName}>
                With brooding guide, feed guide &amp; vaccination program
              </li>
              <li className={priceBulletClassName}>
                P140/head (100 heads or more)
              </li>
              <li className={priceBulletClassName}>P160/head (50-99 heads)</li>
            </ul>
            <F1CheckRow
              label="Layer Type"
              labelClassName="text-[18px] leading-normal text-black"
              checked={layerSelected}
              onToggle={() =>
                setValue("layerSelected", !layerSelected, {
                  shouldValidate: true,
                })
              }
              className="mt-[24px] lg:mt-[27px]"
            />
            <F1AmountField
              containerClassName="mt-[24px] lg:mt-[27px]"
              error={errors.layerAmount?.message}
              {...register("layerAmount")}
            />
          </section>

          <section className="w-full lg:w-[510px]">
            <p className="text-[18px] font-bold leading-normal text-black">
              For F1 Inasal Meat Type:
            </p>
            <ul className={`${bulletListClassName} lg:w-[505px]`}>
              <li className={bulletClassName}>
                For chicken meat production, pre-selected males
              </li>
              <li className={bulletClassName}>
                1.4-1.6 kg live weight at 70 days
              </li>
              <li className={nestedBulletClassName}>
                Hardy and sturdy under free-range conditions
              </li>
              <li className={bulletClassName}>
                Appearance, meat texture &amp; taste similar to native chicken
              </li>
              <li className={bulletClassName}>
                Faster growth compared to native chicken
              </li>
              <li className={bulletClassName}>
                Dominant CZ breed lines, released at 1-3 days old
              </li>
              <li className={bulletClassName}>
                Vaccinated against HVT, ND, IBD at day 1
              </li>
              <li className={nestedBulletClassName}>
                Suitable for free-range &amp; organic production
              </li>
              <li className={nestedBulletClassName}>
                With veterinary health certificate
              </li>
              <li className={bulletClassName}>
                With brooding guide, feed guide &amp; vaccination program
              </li>
              <li className={priceBulletClassName}>
                P65/head (100 heads or more)
              </li>
              <li className={priceBulletClassName}>P75/head (50-99 heads)</li>
            </ul>
            {/* Figma erratum: frames 450:1569 / 255:3697 label this row "Layer
                Type" too (copy-paste slip) — it sits under "For F1 Inasal Meat
                Type:" and maps to the Inasal Type product, so the correct
                label is used. */}
            <F1CheckRow
              label="Inasal Type"
              labelClassName="text-[18px] leading-normal text-black"
              checked={inasalSelected}
              onToggle={() =>
                setValue("inasalSelected", !inasalSelected, {
                  shouldValidate: true,
                })
              }
              className="mt-[24px] lg:mt-[27px]"
            />
            <F1AmountField
              containerClassName="mt-[24px] lg:mt-[27px]"
              inputWidthClassName="lg:w-[269px]"
              error={errors.inasalAmount?.message}
              {...register("inasalAmount")}
            />
          </section>
        </div>

        {/* Artisan Eggers / order schedule */}
        <div className="mt-[40px] flex flex-col gap-[48px] lg:mt-[42px] lg:flex-row lg:justify-between lg:gap-0">
          <section className="w-full lg:w-[519px]">
            <p className="text-[18px] font-bold leading-normal text-black">
              {`F1 Artisan Eggers "Rainbow Eggs":`}
            </p>
            <ul className={`${bulletListClassName} lg:w-[514px]`}>
              <li className={bulletClassName}>
                For specialty egg production, pre-selected females
              </li>
              <li className={bulletClassName}>
                Produces dark brown, green, olive green &amp; specialty egg
                colors
              </li>
              <li className={bulletClassName}>
                Mixed batch of available Artisan Egger lines
              </li>
              <li className={bulletClassName}>
                Ideal for backyard, cage-free &amp; free-range farms
              </li>
              <li className={nestedBulletClassName}>Released at 1-3 days old</li>
              <li className={bulletClassName}>
                Vaccinated against HVT, ND, IBD at day 1
              </li>
              <li className={nestedBulletClassName}>
                With veterinary health certificate
              </li>
              <li className={nestedBulletClassName}>
                With brooding guide, feed guide &amp; vaccination program
              </li>
              <li className={bulletClassName}>
                Distribution is based on available Artisan lines during hatch
              </li>
              <li className={bulletClassName}>
                Follows confirmed pre-booking list
              </li>
              <li className={bulletClassName}>First come, first served</li>
              <li className={priceBulletClassName}>P220/head</li>
              <li className={priceBulletClassName}>
                Minimum Order Quantity: 65 heads
              </li>
            </ul>
            <F1CheckRow
              label="Artisan Line"
              labelClassName="text-[16px] leading-normal text-black lg:text-[15px]"
              checked={artisanSelected}
              onToggle={() =>
                setValue("artisanSelected", !artisanSelected, {
                  shouldValidate: true,
                })
              }
              className="mt-[24px] lg:mt-[27px]"
            />
            <F1AmountField
              containerClassName="mt-[24px] lg:mt-[17px]"
              error={errors.artisanAmount?.message}
              {...register("artisanAmount")}
            />
          </section>

          <section className="w-full lg:w-[510px]">
            <p className="text-[16px] leading-normal text-black lg:text-[15px]">
              When do you need your F1 chicks?{" "}
              <span className="text-[#c00]">*</span>
            </p>
            <div ref={monthRef} className="relative mt-[24px] lg:mt-[32px]">
              <button
                type="button"
                onClick={() => setMonthOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={monthOpen}
                className="relative h-[56px] w-full cursor-pointer rounded-[11px] border border-[#181818] bg-white px-[30px] text-center text-[18px] leading-normal text-black lg:h-[53px]"
              >
                {neededMonth}
                <img
                  src="/figma/icon-select-arrow.svg"
                  alt=""
                  className="absolute right-[18px] top-1/2 h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                />
              </button>
              {monthOpen && (
                <div className="absolute left-0 top-[calc(100%+6px)] z-10 w-full rounded-[15px] bg-white px-[24px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[20px] lg:py-[47px]">
                  <div
                    role="listbox"
                    aria-label="When do you need your F1 chicks?"
                    className="mx-auto grid w-full max-w-[470px] grid-cols-3 gap-x-[16px] gap-y-[12px] md:grid-cols-5"
                  >
                    {SCHEDULE_OPTIONS.map((option) => {
                      const selected = neededMonth === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => selectSchedule(option)}
                          className={`flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-[8px] px-[8px] text-center text-[16px] leading-normal transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#181818] lg:text-[18px] ${
                            selected ? "font-bold text-[#c00]" : "text-black"
                          } ${
                            // Mobile: 12 months fill 4 rows of 3; center
                            // "Other" in the middle column of the final row.
                            option === "Other" ? "col-start-2 md:col-start-auto" : ""
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {neededMonth === "Other" && (
              <div className="mt-[32px] lg:mt-[44px]">
                <label
                  htmlFor="order-otherSchedule"
                  className="block text-[16px] leading-normal text-black lg:text-[15px]"
                >
                  Other / Multiple Order Schedule{" "}
                  <span className="text-[#c00]">*</span>
                </label>
                <input
                  id="order-otherSchedule"
                  type="text"
                  placeholder="Text here..."
                  aria-invalid={errors.otherSchedule ? true : undefined}
                  className="mt-[24px] h-[26px] w-full border-b border-black bg-transparent text-[16px] leading-normal text-black outline-none placeholder:italic placeholder:text-black lg:mt-[27px] lg:h-[20px] lg:text-[12px]"
                  {...register("otherSchedule")}
                />
                {errors.otherSchedule && (
                  <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
                    {errors.otherSchedule.message}
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {errors.layerSelected && (
          <p className="mt-[24px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
            {errors.layerSelected.message}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-[40px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[8px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60 lg:mt-[49px] lg:h-[57px]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            {submitting ? "Submitting..." : "Submit Registration"}
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
