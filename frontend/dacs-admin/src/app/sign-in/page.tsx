"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { signInWithGoogle } from "@/lib/auth";
import { PRIVACY_POLICY_URL, TERMS_AND_CONDITIONS_URL } from "@/lib/legal";
import { IDLE_TIMEOUT_MINUTES } from "@/lib/sessionExpiry";

/*
 * NOTES (Log In): "Instead of doing a login/register page, we will copy
 * CIIT login format — google acc login through business domain."
 * Sign-in is REAL Google authentication: the button below opens the
 * genuine Google/Firebase account-selector popup
 * (signInWithPopup(GoogleAuthProvider)). DACS never renders its own
 * password field and never sees the user's Google password. Whether an
 * authenticated Google account may enter the portal is decided by the
 * DACS backend (pre-authorized staff row, role, ACTIVE status).
 */

function GoogleG({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);

  /*
   * ?reason= is set when the portal signed the user out on its own
   * (idle timeout, or the backend's absolute session cap). Read from
   * window instead of useSearchParams to keep the page out of a
   * Suspense boundary.
   */
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "idle") {
      setSignOutNotice(
        `For your security, you were signed out after ${IDLE_TIMEOUT_MINUTES} minutes of inactivity. Please sign in again.`
      );
    } else if (reason === "expired") {
      setSignOutNotice("Your session has expired. Please sign in again.");
    }
  }, []);

  async function handleGoogleSignIn() {
    if (signingIn) return;
    setSignInError(null);
    setSignOutNotice(null);
    setSigningIn(true);
    try {
      const result = await signInWithGoogle();
      if (result.error || !result.session) {
        setSignInError(result.error ?? "Unable to sign in. Please try again.");
        return;
      }
      router.push("/dashboard");
    } catch {
      /* Never surface raw errors — the sign-in simply did not complete. */
      setSignInError("Unable to sign in. Please try again.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#1f1f1f] text-[#e3e3e3]">
      <div className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-6 py-10 sm:px-10 sm:py-12">
        <GoogleG />

        <div className="mt-10 grid flex-1 grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h1 className="text-3xl font-normal leading-tight sm:text-[42px]">
              Sign in
            </h1>
            <p className="mt-4 text-[15px] text-[#9aa0a6]">
              Use your authorized Google account to access the DACS admin
              portal.
            </p>
          </div>

          <div className="flex flex-col justify-center">
            {signOutNotice && (
              <p
                role="status"
                className="mb-4 rounded-lg border border-[#8ab4f8]/50 bg-[#8ab4f8]/10 px-4 py-3 text-sm text-[#8ab4f8]"
              >
                {signOutNotice}
              </p>
            )}
            {signInError && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-[#f28b82]/50 bg-[#f28b82]/10 px-4 py-3 text-sm text-[#f28b82]"
              >
                {signInError}
              </p>
            )}

            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={signingIn}
              className="flex items-center justify-center gap-3 rounded-full border border-white/25 bg-white px-6 py-3.5 text-[15px] font-semibold text-[#1f1f1f] hover:opacity-90 disabled:opacity-60"
            >
              <GoogleG size={20} />
              {signingIn ? "Waiting for Google…" : "Sign in with Google"}
            </button>

            <p className="mt-5 text-center text-[13px] text-[#9aa0a6]">
              Access is limited to accounts authorized by the Owner. Your
              Google password is entered on Google&apos;s own page — never
              here.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1040px] flex-wrap items-center justify-between gap-3 px-6 pb-6 text-[13px] text-[#9aa0a6] sm:px-10">
        <span>English (United States)</span>
        <div className="flex gap-8">
          <span>Help</span>
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            Privacy
          </a>
          <a
            href={TERMS_AND_CONDITIONS_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-white"
          >
            Terms
          </a>
        </div>
      </div>
    </div>
  );
}
