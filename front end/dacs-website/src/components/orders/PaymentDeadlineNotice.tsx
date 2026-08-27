/*
 * Payment-deadline notice shown on order surfaces (checkout receipt +
 * Order History detail). The customer process is EMAIL ONLY: proof of
 * payment goes to the DACS email address, never through the website.
 * The 14-day window mirrors the backend's PAYMENT_PROOF_DEADLINE_DAYS in
 * order.service — each order stores its own paymentDeadlineAt and the
 * backend cancels unpaid orders past it automatically.
 */
import { MONTHS } from "@/constants/months";

export const PAYMENT_PROOF_DEADLINE_DAYS = 14;

/*
 * THE proof-of-payment inbox — the single place the customer site takes
 * it from (checkout panel, post-checkout pop-up, Order History, About
 * fallback FAQ). To point everything at the real DACS mailbox: change
 * this value, mirror it in back end/scripts/seed-website-faqs.ts and
 * re-run that script (updates the live FAQ row), then rebuild the site.
 */
export const PAYMENT_PROOF_EMAIL = "dacs@gmail.com";

export function formatDeadlineDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function PaymentDeadlineNotice({
  className = "",
  deadline,
}: {
  className?: string;
  /** The order's stored paymentDeadlineAt (ISO), when known. */
  deadline?: string | null;
}) {
  const deadlineDate = formatDeadlineDate(deadline);

  return (
    <div
      role="alert"
      className={`rounded-[15px] border border-[#c00] bg-[#fdecec] px-[20px] py-[16px] text-left ${className}`}
    >
      <p className="text-[15px] font-bold leading-normal text-[#c00]">
        Secure your order: send proof of payment within{" "}
        {PAYMENT_PROOF_DEADLINE_DAYS} days
      </p>
      <p className="mt-[6px] text-[14px] leading-normal text-black">
        To reserve your order, email your proof of payment to{" "}
        <a
          href={`mailto:${PAYMENT_PROOF_EMAIL}`}
          className="font-semibold underline"
        >
          {PAYMENT_PROOF_EMAIL}
        </a>{" "}
        within {PAYMENT_PROOF_DEADLINE_DAYS} days of checkout
        {deadlineDate ? ` (by ${deadlineDate})` : ""}. Proof of payment is
        accepted by email only. If no payment is recorded before the
        deadline, your order will be cancelled automatically.
      </p>
    </div>
  );
}
