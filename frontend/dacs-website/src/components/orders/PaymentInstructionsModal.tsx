"use client";

/*
 * Post-checkout "What happens next" pop-up, shown on every successful
 * checkout (VET cart, F1 form, PS form). Many DACS customers are older
 * farmers, so this is deliberately large, high-contrast and single-
 * purpose: proof of payment goes BY EMAIL to PAYMENT_PROOF_EMAIL within
 * the 14-day window, or the backend cancels the order automatically.
 * Dismissed only by the big "I Understand" button (or Escape) so it
 * cannot be missed.
 */
import { useEffect } from "react";
import {
  formatDeadlineDate,
  PAYMENT_PROOF_DEADLINE_DAYS,
  PAYMENT_PROOF_EMAIL,
} from "@/components/orders/PaymentDeadlineNotice";

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-[14px]">
      <span
        aria-hidden="true"
        className="mt-[2px] flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#c00] text-[18px] font-bold text-white"
      >
        {number}
      </span>
      <p className="text-[18px] leading-[1.5] text-black">{children}</p>
    </li>
  );
}

export function PaymentNextSteps({ deadline }: { deadline?: string | null }) {
  const deadlineDate = formatDeadlineDate(deadline);

  return (
    <div>
      <ol className="flex flex-col gap-[18px]">
        <Step number={1}>
          DACS staff will review your order and confirm your quotation.
        </Step>
        <Step number={2}>
          <span className="font-bold">Send your proof of payment</span> (a
          photo or screenshot of your receipt) by email to:
        </Step>
      </ol>
      <a
        href={`mailto:${PAYMENT_PROOF_EMAIL}`}
        className="mt-[14px] block rounded-[12px] border-2 border-[#c00] bg-[#fdecec] px-[16px] py-[14px] text-center text-[22px] font-bold text-[#c00] underline underline-offset-4 sm:text-[26px]"
      >
        {PAYMENT_PROOF_EMAIL}
      </a>
      <ol start={3} className="mt-[18px] flex flex-col gap-[18px]">
        <Step number={3}>
          Do this within{" "}
          <span className="font-bold">
            {PAYMENT_PROOF_DEADLINE_DAYS} days
          </span>
          {deadlineDate ? (
            <>
              {" "}
              — on or before{" "}
              <span className="font-bold">{deadlineDate}</span>
            </>
          ) : null}
          .
        </Step>
      </ol>
      <div
        role="alert"
        className="mt-[22px] rounded-[12px] bg-[#c00] px-[18px] py-[16px]"
      >
        <p className="text-[17px] font-bold leading-[1.5] text-white">
          Important: if no payment is recorded within{" "}
          {PAYMENT_PROOF_DEADLINE_DAYS} days, your order will be cancelled
          automatically.
        </p>
      </div>
    </div>
  );
}

export function PaymentInstructionsModal({
  orderNumber,
  deadline,
  onClose,
}: {
  orderNumber?: string | null;
  deadline?: string | null;
  onClose: () => void;
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
      aria-labelledby="payment-instructions-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(24,24,24,0.75)] px-[16px] py-[24px]"
    >
      <div className="max-h-full w-full max-w-[620px] overflow-y-auto rounded-[15px] bg-white px-[24px] py-[28px] shadow-[0px_0px_25px_0px_rgba(0,0,0,0.35)] sm:px-[38px] sm:py-[34px]">
        <p
          id="payment-instructions-title"
          className="text-center text-[26px] font-bold leading-[1.3] text-black sm:text-[30px]"
        >
          Your Order Has Been Placed
        </p>
        {orderNumber && (
          <p className="mt-[8px] text-center text-[18px] leading-normal text-[#555]">
            Order Number: <span className="font-bold text-black">{orderNumber}</span>
          </p>
        )}
        <p className="mt-[18px] text-[20px] font-bold leading-normal text-[#c00]">
          What happens next
        </p>
        <div className="mt-[14px]">
          <PaymentNextSteps deadline={deadline} />
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
