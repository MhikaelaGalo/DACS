"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import { FormField } from "@/components/profile/ProfileField";
import { ProfileAvatarColumn } from "@/components/profile/ProfileAvatarColumn";
import { useAvatarSelection } from "@/components/profile/useAvatarSelection";
import { useAuth } from "@/components/providers/AuthProvider";
import { LeaveFormDialog } from "@/components/ui/FormCloseButton";
import {
  farmDetailsSchema,
  type FarmDetailsFormValues,
} from "@/lib/validation/account";
import { errorMessage } from "@/lib/api";
import {
  createFarm,
  updateFarm,
  uploadProfileImage,
  type FarmFields,
} from "@/lib/api/account";

// Figma: Farm Details edit (256:6599) — dedicated edit page. Fields are
// real editable inputs prefilled from the saved farm data; Save Changes
// persists through the DACS backend and returns to the view page with
// ?updated=true; Cancel Edit discards changes (confirming first when dirty).
export default function FarmDetailsEditPage() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const {
    preview: avatarPreview,
    file: avatarFile,
    error: avatarError,
    fileInputRef,
    openPicker,
    clearSelection,
    handleFile,
  } = useAvatarSelection();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FarmDetailsFormValues>({
    resolver: zodResolver(farmDetailsSchema),
    defaultValues: { farmName: "", farmAddress: "" },
  });

  useEffect(() => {
    if (!user) return;
    reset({
      farmName: user.farmName ?? "",
      farmAddress: user.farmAddress ?? "",
    });
    setLoaded(true);
  }, [user, reset]);

  if (!user || !loaded) return null;

  const hasUnsavedChanges = isDirty || avatarPreview !== null;

  async function onSubmit(values: FarmDetailsFormValues) {
    if (!user || saving) return;
    setServiceError(null);
    setSaving(true);
    try {
      const fields: FarmFields = {};
      if (values.farmName.trim() !== (user.farmName ?? "")) {
        fields.farmName = values.farmName.trim();
      }
      if (values.farmAddress.trim() !== (user.farmAddress ?? "")) {
        // A re-typed address replaces addressLine1 and clears the granular
        // PH columns so old and new parts never mix.
        fields.addressLine1 = values.farmAddress.trim();
        fields.barangay = "";
        fields.cityMunicipality = "";
        fields.province = "";
        fields.region = "";
        fields.postalCode = "";
      }
      if (user.primaryFarmId) {
        if (Object.keys(fields).length > 0) {
          await updateFarm(user.primaryFarmId, fields);
        }
      } else {
        // No farm yet — the first save creates it (becomes primary).
        await createFarm({
          farmName: values.farmName.trim(),
          addressLine1: values.farmAddress.trim(),
        });
      }
      if (avatarFile) {
        // The avatar is the shared user profile picture, so saving it here
        // updates the header, profile menu and Personal Information too.
        await uploadProfileImage(avatarFile);
      }
      await refreshUser();
      router.push("/account/farm?updated=true");
    } catch (error) {
      setServiceError(
        errorMessage(error, "Unable to save the farm details. Please try again.")
      );
      setSaving(false);
    }
  }

  function cancelEditing() {
    if (hasUnsavedChanges) {
      setLeaveOpen(true);
      return;
    }
    router.push("/account/farm");
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="lg:flex lg:items-start lg:pb-[60px]"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        aria-label="Change Photo"
        className="hidden"
        onChange={handleFile}
      />
      <ProfileAvatarColumn
        avatarUrl={avatarPreview ?? user.avatarUrl}
        alt={user.fullName}
        editing
        onChangePhoto={openPicker}
      >
        <button
          type="submit"
          disabled={saving}
          className={`${DARK_BUTTON} disabled:opacity-60`}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        <button type="button" onClick={cancelEditing} className={OUTLINE_BUTTON}>
          Cancel Edit
        </button>
        {serviceError && (
          <p
            role="alert"
            className="text-center text-[14px] leading-normal text-[#c00] lg:text-left"
          >
            {serviceError}
          </p>
        )}
        {avatarError && (
          <p className="text-center text-[14px] leading-normal text-[#c00] lg:text-left">
            {avatarError}
          </p>
        )}
        {avatarPreview && (
          <button
            type="button"
            onClick={clearSelection}
            className="cursor-pointer text-center text-[15px] font-semibold leading-normal text-[#c00] underline lg:text-left"
          >
            Remove selected photo
          </button>
        )}
      </ProfileAvatarColumn>

      <section className="mt-[40px] min-w-0 flex-1 lg:ml-[44px] lg:mr-[42px] lg:mt-[45px]">
        <h1 className="text-[24px] font-semibold leading-normal text-black">
          Farm Information
        </h1>

        <div className="mt-[20px] flex max-w-[849px] flex-col gap-y-[20px]">
          <FormField
            label="Farm Name"
            registration={register("farmName")}
            error={errors.farmName?.message}
          />
          <FormField
            label="Farm Address"
            registration={register("farmAddress")}
            error={errors.farmAddress?.message}
          />
        </div>
      </section>

      <LeaveFormDialog
        open={leaveOpen}
        onStay={() => setLeaveOpen(false)}
        onLeave={() => {
          setLeaveOpen(false);
          router.push("/account/farm");
        }}
      />
    </form>
  );
}
