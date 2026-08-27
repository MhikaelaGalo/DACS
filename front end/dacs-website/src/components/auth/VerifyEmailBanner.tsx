"use client";

import { useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  resendVerificationEmail,
} from "@/services/auth.service";

/**
 * Shown across the signed-in areas while the account's email address is
 * unverified. Reading is fine unverified, but the backend rejects every
 * write (profile setup, farms, orders, seminars, tickets) until the
 * emailed verification link is opened — this banner explains that and
 * offers a resend plus a refresh once they've clicked the link.
 */
export function VerifyEmailBanner() {
  const { user, refreshVerification } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!user || user.emailVerified) return null;

  async function onResend() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await resendVerificationEmail();
    setNotice(result.error ?? "Verification email sent — check your inbox.");
    setBusy(false);
  }

  async function onRefresh() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await refreshVerification();
    if (result.user && !result.user.emailVerified) {
      setNotice(
        "Still unverified — open the link in the email we sent, then try again."
      );
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-[20px] pt-[16px] lg:px-[42px]">
      <div className="rounded-[10px] bg-[#fff4e0] px-[20px] py-[14px]">
        <p className="text-[15px] leading-normal text-[#7a5200]">
          <span className="font-semibold">Verify your email address.</span>{" "}
          We sent a verification link to {user.email}. Until it is opened,
          you can browse but not save changes, order, or take seminars.
        </p>
        <div className="mt-[8px] flex flex-wrap items-center gap-x-[20px] gap-y-[6px]">
          <button
            type="button"
            onClick={onResend}
            disabled={busy}
            className="cursor-pointer text-[15px] font-semibold leading-normal text-[#c00] underline-offset-2 hover:underline disabled:opacity-60"
          >
            Resend email
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="cursor-pointer text-[15px] font-semibold leading-normal text-[#c00] underline-offset-2 hover:underline disabled:opacity-60"
          >
            I&apos;ve verified — refresh
          </button>
          {notice && (
            <p role="status" className="text-[14px] leading-normal text-[#7a5200]">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
