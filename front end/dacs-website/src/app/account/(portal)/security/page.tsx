"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import { FormField, ReadOnlyField } from "@/components/profile/ProfileField";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  changePasswordSchema,
  type ChangePasswordFormValues,
} from "@/lib/validation/account";
import { changePassword } from "@/services/auth.service";

// Figma: Security 255:4380 (view) and Security (Edit) 255:4550.
// The edit-mode inputs keep the gray fill, matching the frame exactly.
export default function SecurityPage() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  if (!user) return null;

  function startEditing() {
    reset();
    setServiceError(null);
    setSaved(false);
    setEditing(true);
  }

  function cancelEditing() {
    reset();
    setServiceError(null);
    setEditing(false);
  }

  // The real password change happens in Firebase Authentication: the
  // current password re-authenticates the account, then the new password
  // replaces it. DACS itself never stores passwords.
  async function onSubmit(values: ChangePasswordFormValues) {
    if (saving) return;
    setServiceError(null);
    setSaving(true);
    try {
      const result = await changePassword(
        values.currentPassword,
        values.newPassword
      );
      if (result.error) {
        if (result.error === "Current password is incorrect.") {
          setError("currentPassword", {
            type: "validate",
            message: result.error,
          });
        } else {
          setServiceError(result.error);
        }
        return;
      }
      reset();
      setEditing(false);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="lg:ml-[101px] lg:mr-[42px] lg:pb-[60px] lg:pt-[45px]"
    >
      <h1 className="text-[24px] font-semibold leading-normal text-black">
        Security
      </h1>

      <div className="mt-[20px] flex max-w-[421px] flex-col gap-[20px]">
        {editing ? (
          <>
            <FormField
              label="Current Password"
              type="password"
              placeholder="******************"
              inputClassName="bg-[#d4d4d4]"
              registration={register("currentPassword")}
              error={errors.currentPassword?.message}
            />
            <FormField
              label="New Password"
              type="password"
              placeholder="*******"
              inputClassName="bg-[#d4d4d4]"
              registration={register("newPassword")}
              error={errors.newPassword?.message}
            />
            <FormField
              label="Confirm New Password"
              type="password"
              placeholder="*******"
              inputClassName="bg-[#d4d4d4]"
              registration={register("confirmNewPassword")}
              error={errors.confirmNewPassword?.message}
            />
          </>
        ) : (
          <>
            <ReadOnlyField
              label="Current Password"
              value="******************"
            />
            <ReadOnlyField label="New Password" value="*******" />
            <ReadOnlyField label="Confirm New Password" value="*******" />
          </>
        )}
      </div>

      {/* Action row sits in normal flow directly beneath the form fields,
          aligned to the 421px form column (no min-height/anchored layout). */}
      {editing ? (
        <>
          <div className="mt-[32px] flex flex-col gap-[18px] sm:flex-row">
            <button
              type="submit"
              disabled={saving}
              className={`${DARK_BUTTON} disabled:opacity-60 sm:w-[216px]`}
            >
              {saving ? "Updating..." : "Update Password"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className={`${OUTLINE_BUTTON} sm:w-[216px]`}
            >
              Cancel Edit
            </button>
          </div>
          {serviceError && (
            <p
              role="alert"
              className="mt-[16px] max-w-[421px] text-[15px] leading-normal text-[#c00]"
            >
              {serviceError}
            </p>
          )}
        </>
      ) : (
        <div className="mt-[32px] flex flex-col gap-[12px]">
          <button
            type="button"
            onClick={startEditing}
            className={`${DARK_BUTTON} sm:w-[216px]`}
          >
            Edit Password
          </button>
          {saved && (
            <p
              role="status"
              className="text-[15px] font-semibold leading-normal text-[#188038]"
            >
              Password updated successfully.
            </p>
          )}
        </div>
      )}
    </form>
  );
}
