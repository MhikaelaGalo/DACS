"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthLayout } from "@/components/forms/AuthLayout";
import { AuthSubmitButton } from "@/components/forms/AuthSubmitButton";
import { FormField } from "@/components/forms/FormField";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";
import { registerSchema, type RegisterFormValues } from "@/lib/validation/auth";

// Figma: Register (203:529)
export default function RegisterPage() {
  const router = useRouter();
  const { register: registerAccount } = useAuth();
  const [serviceError, setServiceError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServiceError(null);
    const result = await registerAccount(values);
    if (result.error) {
      setServiceError(result.error);
      return;
    }
    // Registration does not start a session — the customer signs in
    // explicitly (the Sign In page shows a success notice mentioning the
    // emailed verification link).
    router.push(`${ROUTES.signIn}?registered=true`);
  });

  return (
    <AuthLayout
      activeTab="register"
      bottomPaddingClassName="pb-[80px] lg:pb-[85px]"
    >
      <form onSubmit={onSubmit} noValidate>
        <FormField
          label="Full Name"
          showAsterisk
          autoComplete="name"
          containerClassName="mt-[32px] lg:mt-[42px]"
          error={errors.fullName?.message}
          {...register("fullName")}
        />
        <FormField
          label="Email"
          type="email"
          showAsterisk
          autoComplete="email"
          containerClassName="mt-[24px] lg:mt-[23px]"
          error={errors.email?.message}
          {...register("email")}
        />
        <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[23px] lg:flex-row lg:gap-[22px]">
          <FormField
            label="Password"
            type="password"
            showAsterisk
            autoComplete="new-password"
            containerClassName="w-full lg:w-[222px]"
            error={errors.password?.message}
            {...register("password")}
          />
          <FormField
            label="Confirm Password"
            type="password"
            showAsterisk
            autoComplete="new-password"
            containerClassName="w-full lg:w-[222px]"
            error={errors.confirmPassword?.message}
            {...register("confirmPassword")}
          />
        </div>
        <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[28px] lg:flex-row lg:gap-[22px]">
          <FormField
            label="Contact Number"
            type="tel"
            showAsterisk
            autoComplete="tel"
            containerClassName="w-full lg:w-[222px]"
            error={errors.contactNumber?.message}
            {...register("contactNumber")}
          />
          <FormField
            label="Complete Address"
            showAsterisk
            autoComplete="street-address"
            containerClassName="w-full lg:w-[222px]"
            error={errors.completeAddress?.message}
            {...register("completeAddress")}
          />
        </div>
        <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[28px] lg:flex-row lg:gap-[22px]">
          <FormField
            label="Farm Name"
            showAsterisk
            containerClassName="w-full lg:w-[222px]"
            error={errors.farmName?.message}
            {...register("farmName")}
          />
          <FormField
            label="Farm Address"
            showAsterisk
            containerClassName="w-full lg:w-[222px]"
            error={errors.farmAddress?.message}
            {...register("farmAddress")}
          />
        </div>
        <AuthSubmitButton
          className="mt-[24px] disabled:opacity-60"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating Account..." : "Create Account"}
        </AuthSubmitButton>
        {serviceError && (
          <p className="mt-[12px] text-center text-[16px] leading-normal text-[#c00] lg:text-[14px]">
            {serviceError}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
