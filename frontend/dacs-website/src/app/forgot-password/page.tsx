"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout } from "@/components/forms/AuthLayout";
import { AuthSubmitButton } from "@/components/forms/AuthSubmitButton";
import { FormField } from "@/components/forms/FormField";
import { ROUTES } from "@/constants/routes";
import {
  forgotPasswordEmailSchema,
  type ForgotPasswordEmailValues,
} from "@/lib/validation/auth";
import { requestPasswordReset } from "@/services/auth.service";

type Step = "email" | "sent";

const STEP_BOTTOM_PADDING: Record<Step, string> = {
  email: "pb-[80px] lg:pb-[198px]",
  sent: "pb-[80px] lg:pb-[220px]",
};

/** Masks an email like the Figma copy: jo******23@gmail.com (535:652). */
function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return email;
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 4) {
    return `${local[0] ?? ""}${"*".repeat(Math.max(local.length - 1, 2))}${domain}`;
  }
  return `${local.slice(0, 2)}${"*".repeat(local.length - 4)}${local.slice(-2)}${domain}`;
}

// Figma: Forgot Password (535:586). Password recovery goes through the
// real account system: a secure reset LINK is emailed (never a typed
// code), and the new password is set on the page that link opens.
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const emailForm = useForm<ForgotPasswordEmailValues>({
    resolver: zodResolver(forgotPasswordEmailSchema),
  });

  const onSubmitEmail = emailForm.handleSubmit(async (values) => {
    setServiceError(null);
    const result = await requestPasswordReset(values.email);
    if (result.error) {
      setServiceError(result.error);
      return;
    }
    setEmail(values.email);
    setStep("sent");
  });

  const onResend = async () => {
    setServiceError(null);
    setResent(false);
    const result = await requestPasswordReset(email);
    if (result.error) {
      setServiceError(result.error);
      return;
    }
    setResent(true);
  };

  return (
    <AuthLayout
      activeTab="sign-in"
      bottomPaddingClassName={STEP_BOTTOM_PADDING[step]}
    >
      {step === "email" && (
        <form onSubmit={onSubmitEmail} noValidate>
          <p className="mt-[32px] text-justify text-[18px] leading-normal text-black lg:mt-[31px]">
            Please input your registered email address and we will send a
            secure link to reset your password.
          </p>
          <FormField
            label="Email Address"
            type="email"
            placeholder="your@email.com"
            autoComplete="email"
            containerClassName="mt-[32px] lg:mt-[31px]"
            error={emailForm.formState.errors.email?.message}
            {...emailForm.register("email")}
          />
          <AuthSubmitButton
            className="mt-[28px] disabled:opacity-60 lg:mt-[27px]"
            disabled={emailForm.formState.isSubmitting}
          >
            {emailForm.formState.isSubmitting ? "Sending..." : "Send Reset Link"}
          </AuthSubmitButton>
          {serviceError && (
            <p className="mt-[12px] text-center text-[16px] leading-normal text-[#c00] lg:text-[14px]">
              {serviceError}
            </p>
          )}
        </form>
      )}

      {step === "sent" && (
        <div>
          <p className="mt-[32px] text-justify text-[18px] leading-normal text-black lg:mt-[31px]">
            If an account exists for {maskEmail(email)}, a password reset
            link is on its way. Open the email and follow the link to choose
            a new password, then sign in here.
          </p>
          <p className="mt-[20px] text-justify text-[16px] leading-normal text-[#555]">
            The email can take a minute to arrive — check your spam folder
            too.
          </p>
          <button
            type="button"
            onClick={onResend}
            className="mt-[24px] block w-fit cursor-pointer text-[18px] leading-normal text-[#c00] underline-offset-2 hover:underline"
          >
            Resend the link
          </button>
          {resent && (
            <p role="status" className="mt-[8px] text-[16px] leading-normal text-[#188038]">
              Reset link sent again.
            </p>
          )}
          {serviceError && (
            <p className="mt-[8px] text-[16px] leading-normal text-[#c00]">
              {serviceError}
            </p>
          )}
          <Link
            href={ROUTES.signIn}
            className="mt-[28px] flex h-[64px] w-full items-center justify-center rounded-[15px] bg-[#181818] text-[18px] font-bold leading-normal text-[#f4f4f4] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
          >
            Back to Sign In
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
