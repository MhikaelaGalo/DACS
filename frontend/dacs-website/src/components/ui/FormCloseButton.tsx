"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

// Reusable X close button for form and seminar-flow pages. Renders inside a
// `relative` container near its upper-left corner, navigates to fallbackHref
// on click, and asks for confirmation first when the form has unsaved changes.
interface FormCloseButtonProps {
  /** Safe in-app destination the X exits to. */
  fallbackHref: string;
  /** When true, clicking the X opens the "Leave this form?" confirmation. */
  hasUnsavedChanges?: boolean;
  ariaLabel?: string;
  /** Position overrides (absolute offsets) for the host container. */
  className?: string;
}

interface LeaveFormDialogProps {
  open: boolean;
  /** Called when the user chooses to stay ("Continue Editing" or Escape). */
  onStay: () => void;
  /** Called when the user confirms leaving the form. */
  onLeave: () => void;
}

// "Leave this form?" confirmation dialog, shared by the X close button and
// form Cancel buttons.
export function LeaveFormDialog({ open, onStay, onLeave }: LeaveFormDialogProps) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  // While the dialog is open: focus lands on "Continue Editing" and Escape
  // closes the dialog (staying on the page — it never leaves the form).
  useEffect(() => {
    if (!open) return;
    continueButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onStay();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="leave-form-title"
      aria-describedby="leave-form-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(24,24,24,0.6)] px-[24px]"
    >
      <div className="w-full max-w-[520px] rounded-[15px] bg-white px-[28px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[36px] lg:py-[38px]">
        <p
          id="leave-form-title"
          className="text-[22px] font-semibold leading-normal text-black lg:text-[24px]"
        >
          Leave this form?
        </p>
        <p
          id="leave-form-message"
          className="mt-[12px] text-[16px] leading-normal text-[#6b6b6b] lg:text-[18px]"
        >
          Your unsaved changes will be lost if you leave this page.
        </p>
        <div className="mt-[28px] flex flex-col gap-[12px] sm:flex-row sm:justify-end">
          <button
            ref={continueButtonRef}
            type="button"
            onClick={onStay}
            className="flex h-[48px] cursor-pointer items-center justify-center rounded-[11px] border border-[#181818] px-[24px] text-[16px] font-bold leading-normal text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#181818]"
          >
            Continue Editing
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="flex h-[48px] cursor-pointer items-center justify-center rounded-[11px] bg-[#c00] px-[24px] text-[16px] font-bold leading-normal text-[#f4f4f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c00]"
          >
            Leave Form
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormCloseButton({
  fallbackHref,
  hasUnsavedChanges = false,
  ariaLabel = "Close form",
  className = "left-[16px] top-[16px] lg:left-[38px] lg:top-[30px]",
}: FormCloseButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const leave = useCallback(() => {
    setConfirmOpen(false);
    router.push(fallbackHref);
  }, [router, fallbackHref]);

  const stay = useCallback(() => setConfirmOpen(false), []);

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        title="Close"
        onClick={() => (hasUnsavedChanges ? setConfirmOpen(true) : leave())}
        className={`absolute z-10 flex size-[44px] cursor-pointer items-center justify-center rounded-full text-black transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#181818] ${className}`}
      >
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
      <LeaveFormDialog open={confirmOpen} onStay={stay} onLeave={leave} />
    </>
  );
}
