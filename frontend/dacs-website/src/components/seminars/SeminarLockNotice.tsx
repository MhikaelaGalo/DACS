"use client";

import { useRouter } from "next/navigation";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import {
  continueSeminarHref,
  type SeminarEligibility,
} from "@/services/eligibility.service";

// Locked-order notice for chick (PS/F1) ordering while the sequential
// seminar prerequisite (Module 1 -> 2 -> 3) is incomplete. DACS dialog
// language: dark scrim, white rounded-[15px] card, dark/outline buttons.

const LABEL_CLASSES: Record<string, string> = {
  Completed: "text-[#188038]",
  "In Progress": "text-[#b06f00]",
  "Not Started": "text-[#6b6b6b]",
  Locked: "text-[#c00]",
};

function ProgressRows({ eligibility }: { eligibility: SeminarEligibility }) {
  return (
    <div className="flex flex-col gap-[10px]">
      {eligibility.progress.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center justify-between rounded-[11px] bg-[#f4f4f4] px-[16px] py-[10px]"
        >
          <span className="text-[16px] font-semibold leading-normal text-black">
            {entry.name}
          </span>
          <span
            className={`text-[15px] font-bold leading-normal ${LABEL_CLASSES[entry.label]}`}
          >
            {entry.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SeminarLockNotice({
  open,
  onClose,
  eligibility,
}: {
  open: boolean;
  onClose: () => void;
  eligibility: SeminarEligibility;
}) {
  const router = useRouter();
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="seminar-lock-title"
      aria-describedby="seminar-lock-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(24,24,24,0.6)] px-[24px]"
    >
      <div className="w-full max-w-[560px] rounded-[15px] bg-white px-[28px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[36px] lg:py-[38px]">
        <p
          id="seminar-lock-title"
          className="text-[22px] font-semibold leading-normal text-black lg:text-[24px]"
        >
          Complete the Required Seminar Modules
        </p>
        <p
          id="seminar-lock-message"
          className="mt-[12px] text-[16px] leading-normal text-[#6b6b6b] lg:text-[18px]"
        >
          To order chicks, Parent Stocks, or F1 products, you must complete
          Seminar Modules 1, 2, and 3 in order.
        </p>
        <div className="mt-[20px]">
          <ProgressRows eligibility={eligibility} />
        </div>
        <div className="mt-[28px] flex flex-col gap-[12px] sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={OUTLINE_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void continueSeminarHref().then((href) => router.push(href));
            }}
            className={DARK_BUTTON}
          >
            Continue Seminar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compact inline variant for product-description pages and order forms. */
export function SeminarLockInline({
  eligibility,
  className = "",
}: {
  eligibility: SeminarEligibility;
  className?: string;
}) {
  const router = useRouter();
  return (
    <div
      className={`rounded-[15px] bg-[#fff1bf] px-[20px] py-[18px] ${className}`}
    >
      <p className="text-[18px] font-bold leading-normal text-black">
        Complete the Required Seminar Modules
      </p>
      <p className="mt-[6px] text-[15px] leading-normal text-black">
        To order chicks, Parent Stocks, or F1 products, you must complete
        Seminar Modules 1, 2, and 3 in order.
      </p>
      <div className="mt-[12px]">
        <ProgressRows eligibility={eligibility} />
      </div>
      <button
        type="button"
        onClick={() => {
          void continueSeminarHref().then((href) => router.push(href));
        }}
        className={`${DARK_BUTTON} mt-[16px]`}
      >
        Continue Seminar
      </button>
    </div>
  );
}
