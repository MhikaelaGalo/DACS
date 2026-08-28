"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout } from "@/components/forms/AuthLayout";
import { AuthSubmitButton } from "@/components/forms/AuthSubmitButton";
import { FormField } from "@/components/forms/FormField";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";
import { validateReturnToRoute } from "@/lib/auth/routes";
import { signInSchema, type SignInFormValues } from "@/lib/validation/auth";

// Figma: Sign In (320:57). Supports ?returnTo=<in-app route> so guarded
// pages can send visitors here and restore their destination after
// authenticating, and ?registered=true for the post-registration notice.
export default function SignInPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [justRegistered, setJustRegistered] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormValues>({ resolver: zodResolver(signInSchema) });

  // window.location is read in an effect instead of useSearchParams so the
  // statically prerendered page needs no Suspense boundary.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReturnTo(validateReturnToRoute(params.get("returnTo")));
    setJustRegistered(params.get("registered") === "true");
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setServiceError(null);
    try {
      const result = await signIn(values);
      if (result.error || !result.user) {
        setServiceError(
          result.error ??
            "Unable to sign in. Please check your credentials and try again."
        );
        return;
      }
      // Only validated in-app routes are ever restored — never external URLs.
      router.push(returnTo ?? ROUTES.home);
    } catch {
      // Never surface raw auth/service errors to customers.
      setServiceError("Unable to sign in. Please try again later.");
    }
  });

  return (
    <AuthLayout activeTab="sign-in">
      <form onSubmit={onSubmit} noValidate>
        {justRegistered && (
          <p
            role="status"
            className="mt-[24px] text-[16px] font-semibold leading-normal text-[#188038] lg:mt-[28px]"
          >
            Account created successfully. We sent a verification link to your
            email — you can sign in now and verify anytime before placing
            orders.
          </p>
        )}
        <FormField
          label="Email Address"
          type="email"
          placeholder="your@email.com"
          autoComplete="email"
          containerClassName="mt-[32px] lg:mt-[38px]"
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label="Password"
          type="password"
          placeholder="*********"
          autoComplete="current-password"
          containerClassName="mt-[24px] lg:mt-[23px]"
          error={errors.password?.message}
          {...register("password")}
        />
        <Link
          href={ROUTES.forgotPassword}
          className="mt-[24px] block w-fit text-[18px] leading-normal text-[#c00] lg:mt-[23px]"
        >
          Forgot Password?
        </Link>
        <AuthSubmitButton
          className="mt-[24px] disabled:opacity-60 lg:mt-[23px]"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing In..." : "Sign In"}
        </AuthSubmitButton>
        {serviceError && (
          <p
            role="alert"
            className="mt-[12px] text-center text-[16px] leading-normal text-[#c00] lg:text-[14px]"
          >
            {serviceError}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
