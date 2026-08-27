"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Footer } from "@/components/layout/Footer";
import { OrderField } from "@/components/orders/OrderField";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  FormCloseButton,
  LeaveFormDialog,
} from "@/components/ui/FormCloseButton";
import { ROUTES } from "@/constants/routes";
import { formatDate } from "@/lib/utils/format";
import {
  TICKET_CATEGORIES,
  ticketSchema,
  type TicketFormValues,
} from "@/lib/validation/ticket";
import { errorMessage } from "@/lib/api";
import {
  createInquiry,
  TICKET_STATUS_LABELS,
} from "@/lib/api/inquiries";
import { listMyOrders } from "@/lib/api/orders";

/** What the success panel renders after the backend accepts the ticket. */
interface SubmittedTicket {
  ticketNumber: string;
  category: string;
  subject: string;
  dateSubmitted: string;
  status: string;
}

// Submit a Ticket form in the DACS form language (PS order form card rendered
// at 0.75 scale in the 1440px container): dark #181818 page, white 1298px
// rounded-[15px] card, 53px inputs with 18px labels and the red required
// asterisk, dark 64px submit button.
export default function SubmitTicketPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [ticket, setTicket] = useState<SubmittedTicket | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prefilled = useRef(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    reset,
    formState: { errors, isDirty },
  } = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      category: "",
      subject: "",
      description: "",
      orderReference: "",
      paymentReference: "",
      email: "",
      contactNumber: "",
      confirmed: false,
    },
  });

  const category = watch("category");
  const confirmed = watch("confirmed");

  // Prepopulate the contact fields (still editable) once the signed-in user
  // loads; reset keeps them out of the unsaved-changes (isDirty) tracking.
  useEffect(() => {
    if (!user || prefilled.current) return;
    prefilled.current = true;
    reset(
      {
        ...getValues(),
        email: user.email,
        contactNumber: user.contactNumber,
      },
      { keepDirtyValues: true }
    );
  }, [user, reset, getValues]);

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

  const selectCategory = (value: TicketFormValues["category"]) => {
    setValue("category", value, { shouldValidate: true, shouldDirty: true });
    setDropdownOpen(false);
  };

  const cancel = () => {
    if (isDirty) {
      setCancelConfirmOpen(true);
    } else {
      router.push(ROUTES.forms);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (values.category === "" || submitting) return; // Guarded by the schema.
    setServiceError(null);
    setSubmitting(true);
    try {
      // The backend inquiry record carries subject + message (category,
      // references and contact details are folded into the message so
      // staff see every answer); when the typed order reference matches
      // one of this account's order numbers, the ticket links to it.
      let relatedOrderId: string | undefined;
      const orderReference = values.orderReference.trim();
      if (orderReference) {
        try {
          const orders = await listMyOrders();
          relatedOrderId = orders.find(
            (order) =>
              order.orderNumber.toLowerCase() === orderReference.toLowerCase()
          )?.id;
        } catch {
          /* No match — the reference still travels in the message text. */
        }
      }
      const messageLines = [
        `Category: ${values.category}`,
        "",
        values.description.trim(),
      ];
      if (orderReference) {
        messageLines.push("", `Order reference: ${orderReference}`);
      }
      if (values.paymentReference.trim()) {
        messageLines.push(
          `Payment reference: ${values.paymentReference.trim()}`
        );
      }
      messageLines.push(
        "",
        `Contact email: ${values.email.trim()}`
      );
      if (values.contactNumber.trim()) {
        messageLines.push(`Contact number: ${values.contactNumber.trim()}`);
      }
      const created = await createInquiry({
        subject: values.subject.trim(),
        message: messageLines.join("\n").slice(0, 3000),
        ...(relatedOrderId ? { relatedOrderId } : {}),
      });
      setTicket({
        ticketNumber: created.ticketNumber,
        category: values.category,
        subject: created.subject,
        dateSubmitted: created.createdAt,
        status: TICKET_STATUS_LABELS[created.status],
      });
    } catch (error) {
      setServiceError(
        errorMessage(
          error,
          "Unable to submit the ticket right now. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="bg-[#181818]">
      <div className="mx-auto max-w-[1440px] px-[20px] pb-[60px] pt-[40px] lg:pb-[59px] lg:pt-[64px]">
        {ticket ? (
          /* Success state — replaces the form inside the same white card. */
          <div className="relative mx-auto w-full max-w-[1298px] rounded-[15px] bg-white px-[24px] pb-[60px] pt-[60px] lg:px-[50px] lg:pb-[58px] lg:pt-[99px]">
            <FormCloseButton
              fallbackHref={ROUTES.forms}
              ariaLabel="Exit ticket form"
              className="left-[12px] top-[12px] lg:left-[40px] lg:top-[36px]"
            />
            <h1 className="text-center text-[24px] font-semibold leading-normal text-black">
              Ticket Submitted
            </h1>
            <p className="mx-auto mt-[12px] max-w-[700px] text-center text-[16px] leading-normal text-[#6b6b6b] lg:mt-[16px] lg:text-[18px]">
              Your inquiry has been submitted successfully.
            </p>
            <dl className="mx-auto mt-[32px] flex w-full max-w-[599px] flex-col gap-[14px] rounded-[15px] border border-[#181818] px-[20px] py-[24px] lg:mt-[40px] lg:px-[30px]">
              <div className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[16px]">
                <dt className="text-[18px] font-bold leading-normal text-black">
                  Ticket Number
                </dt>
                <dd className="text-[18px] leading-normal text-black">
                  {ticket.ticketNumber}
                </dd>
              </div>
              <div className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[16px]">
                <dt className="text-[18px] font-bold leading-normal text-black">
                  Category
                </dt>
                <dd className="text-[18px] leading-normal text-black">
                  {ticket.category}
                </dd>
              </div>
              <div className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[16px]">
                <dt className="text-[18px] font-bold leading-normal text-black">
                  Subject
                </dt>
                <dd className="text-[18px] leading-normal text-black sm:text-right">
                  {ticket.subject}
                </dd>
              </div>
              <div className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[16px]">
                <dt className="text-[18px] font-bold leading-normal text-black">
                  Date Submitted
                </dt>
                <dd className="text-[18px] leading-normal text-black">
                  {formatDate(ticket.dateSubmitted)}
                </dd>
              </div>
              <div className="flex flex-col gap-[2px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-[16px]">
                <dt className="text-[18px] font-bold leading-normal text-black">
                  Status
                </dt>
                <dd className="text-[18px] leading-normal text-black">
                  {ticket.status}
                </dd>
              </div>
            </dl>
            <Link
              href={ROUTES.accountTickets}
              className="mx-auto mt-[32px] flex h-[64px] w-full max-w-[599px] cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:mt-[40px]"
            >
              <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                Track My Tickets
              </span>
            </Link>
            <Link
              href={ROUTES.forms}
              className="mx-auto mt-[16px] flex h-[64px] w-full max-w-[599px] cursor-pointer items-center justify-center rounded-[15px] border border-[#181818] bg-white"
            >
              <span className="text-[18px] font-bold leading-normal text-black">
                Return to Forms
              </span>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            noValidate
            className="relative mx-auto w-full max-w-[1298px] rounded-[15px] bg-white px-[24px] pb-[60px] pt-[60px] lg:px-[50px] lg:pb-[58px] lg:pt-[99px]"
          >
            <FormCloseButton
              fallbackHref={ROUTES.forms}
              hasUnsavedChanges={isDirty}
              ariaLabel="Exit ticket form"
              className="left-[12px] top-[12px] lg:left-[40px] lg:top-[36px]"
            />
            <h1 className="text-center text-[24px] font-semibold leading-normal text-black">
              Submit a Ticket
            </h1>
            <p className="mx-auto mt-[12px] max-w-[700px] text-center text-[16px] leading-normal text-[#6b6b6b] lg:mt-[16px] lg:text-[18px]">
              Send us your inquiry or concern. You can track the status of your
              submitted ticket from your account.
            </p>

            {/* Inquiry category */}
            <div className="mt-[40px] lg:mt-[48px]">
              <p className="flex items-start gap-[7px] text-[18px] leading-normal text-black">
                <span>Inquiry Category</span>
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
                  {category === "" ? (
                    <span className="font-light italic text-[#7d7d7d]">
                      Select a category
                    </span>
                  ) : (
                    category
                  )}
                  <img
                    src="/figma/icon-select-arrow.svg"
                    alt=""
                    className="absolute right-[18px] top-1/2 h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                  />
                </button>
                {dropdownOpen && (
                  <div
                    role="listbox"
                    aria-label="Inquiry Category"
                    className="absolute left-0 top-[calc(100%+6px)] z-10 max-h-[400px] w-full overflow-y-auto rounded-[15px] bg-white py-[20px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:py-[24px]"
                  >
                    {TICKET_CATEGORIES.map((option, index) => (
                      <Fragment key={option}>
                        {index > 0 && (
                          <img
                            src="/figma/dropdown-divider.svg"
                            alt=""
                            className="mx-auto my-[12px] h-px w-[87%] lg:my-[14px]"
                          />
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={option === category}
                          onClick={() => selectCategory(option)}
                          className="block w-full cursor-pointer px-[16px] text-center text-[18px] leading-normal text-black"
                        >
                          {option}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                )}
              </div>
              {errors.category && (
                <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
                  {errors.category.message}
                </p>
              )}
            </div>

            {/* Subject */}
            <OrderField
              label="Subject"
              showAsterisk
              containerClassName="mt-[24px] w-full lg:mt-[32px]"
              error={errors.subject?.message}
              {...register("subject")}
            />

            {/* Description */}
            <div className="mt-[24px] lg:mt-[32px]">
              <label
                htmlFor="ticket-description"
                className="flex items-start gap-[7px] text-[18px] leading-normal text-black"
              >
                <span>Description</span>
                <img
                  src="/figma/icon-asterisk.svg"
                  alt=""
                  aria-hidden
                  className="h-[9px] w-[8px] -translate-y-[5px]"
                />
              </label>
              <textarea
                id="ticket-description"
                rows={4}
                aria-invalid={errors.description ? true : undefined}
                className="mt-[12px] w-full resize-y rounded-[11px] border border-[#181818] bg-transparent px-[16px] py-[14px] text-[18px] leading-normal text-black outline-none placeholder:font-light placeholder:italic placeholder:text-[#7d7d7d] lg:mt-[23px] lg:px-[19px]"
                {...register("description")}
              />
              {errors.description && (
                <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
                  {errors.description.message}
                </p>
              )}
            </div>

            {/* Related references */}
            <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[32px] lg:flex-row lg:justify-between lg:gap-0">
              <OrderField
                label="Related Order Reference (optional)"
                containerClassName="w-full lg:w-[590px]"
                error={errors.orderReference?.message}
                {...register("orderReference")}
              />
              <OrderField
                label="Related Payment Reference (optional)"
                containerClassName="w-full lg:w-[599px]"
                error={errors.paymentReference?.message}
                {...register("paymentReference")}
              />
            </div>

            {/* Attachments are not supported by the ticket system yet —
                staff request files through the official email thread. */}
            <p className="mt-[24px] text-[15px] leading-normal text-[#7d7d7d] lg:mt-[32px]">
              Need to share a photo or document? Mention it in your
              description — our staff will request files through the official
              DACS email when they respond.
            </p>

            {/* Contact details */}
            <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[32px] lg:flex-row lg:justify-between lg:gap-0">
              <OrderField
                label="Contact Email"
                type="email"
                showAsterisk
                containerClassName="w-full lg:w-[590px]"
                error={errors.email?.message}
                {...register("email")}
              />
              <OrderField
                label="Contact Number (optional)"
                type="tel"
                containerClassName="w-full lg:w-[599px]"
                error={errors.contactNumber?.message}
                {...register("contactNumber")}
              />
            </div>

            {/* Confirmation */}
            <div className="mt-[32px] lg:mt-[40px]">
              <button
                type="button"
                onClick={() =>
                  setValue("confirmed", !confirmed, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                aria-pressed={confirmed}
                className="flex cursor-pointer items-center gap-[13px] text-left lg:pl-[4px]"
              >
                <span className="relative block size-[28px] shrink-0 border border-black lg:size-[26px]">
                  {confirmed && (
                    <span className="absolute inset-[4px] block bg-[#181818]" />
                  )}
                </span>
                <span className="text-[16px] leading-normal text-black lg:text-[18px]">
                  I confirm that the information provided is correct.
                </span>
              </button>
              {errors.confirmed && (
                <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
                  {errors.confirmed.message}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="mt-[40px] flex flex-col gap-[16px] lg:mt-[59px] lg:flex-row lg:gap-[20px]">
              <button
                type="submit"
                disabled={submitting}
                className="flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60 lg:flex-1"
              >
                <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                  {submitting ? "Submitting..." : "Submit Ticket"}
                </span>
              </button>
              <button
                type="button"
                onClick={cancel}
                className="flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] border border-[#181818] bg-white lg:w-[216px]"
              >
                <span className="text-[18px] font-bold leading-normal text-black">
                  Cancel
                </span>
              </button>
            </div>
            {serviceError && (
              <p
                role="alert"
                className="mt-[16px] text-center text-[16px] leading-normal text-[#c00]"
              >
                {serviceError}
              </p>
            )}
          </form>
        )}
      </div>

      <LeaveFormDialog
        open={cancelConfirmOpen}
        onStay={() => setCancelConfirmOpen(false)}
        onLeave={() => {
          setCancelConfirmOpen(false);
          router.push(ROUTES.forms);
        }}
      />

      <Footer />
    </div>
  );
}
