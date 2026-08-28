"use client";

import { useRouter } from "next/navigation";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import { signInHrefFor } from "@/lib/auth/routes";

// "Sign In Required" dialog shown when a signed-out visitor attempts a
// customer-only action (ordering, cart, notifications). DACS dialog language:
// dark scrim, white rounded-[15px] card, dark/outline buttons.
export function SignInRequiredDialog({
  open,
  onClose,
  returnTo,
  message = "You must sign in to your DACS account before ordering a product.",
}: {
  open: boolean;
  onClose: () => void;
  /** In-app destination restored after a successful sign-in. */
  returnTo: string;
  message?: string;
}) {
  const router = useRouter();
  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="signin-required-title"
      aria-describedby="signin-required-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(24,24,24,0.6)] px-[24px]"
    >
      <div className="w-full max-w-[520px] rounded-[15px] bg-white px-[28px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[36px] lg:py-[38px]">
        <p
          id="signin-required-title"
          className="text-[22px] font-semibold leading-normal text-black lg:text-[24px]"
        >
          Sign In Required
        </p>
        <p
          id="signin-required-message"
          className="mt-[12px] text-[16px] leading-normal text-[#6b6b6b] lg:text-[18px]"
        >
          {message}
        </p>
        <div className="mt-[28px] flex flex-col gap-[12px] sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={OUTLINE_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => router.push(signInHrefFor(returnTo))}
            className={DARK_BUTTON}
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
