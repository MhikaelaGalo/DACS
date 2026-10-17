"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import { FormField, ReadOnlyField } from "@/components/profile/ProfileField";
import { ProfileAvatarColumn } from "@/components/profile/ProfileAvatarColumn";
import { useAvatarSelection } from "@/components/profile/useAvatarSelection";
import { useAuth } from "@/components/providers/AuthProvider";
import { LeaveFormDialog } from "@/components/ui/FormCloseButton";
import {
  personalInfoSchema,
  type PersonalInfoFormValues,
} from "@/lib/validation/account";
import { errorMessage } from "@/lib/api";
import {
  createMyProfile,
  updateMyProfile,
  uploadProfileImage,
  type ProfileFields,
} from "@/lib/api/account";
import { splitFullName } from "@/services/auth.service";
import type { User } from "@/types/user";

// Figma: User Info 203:55 (view) and User Info (Edit) 256:6370.
function toFormValues(user: User): PersonalInfoFormValues {
  return {
    fullName: user.fullName,
    // The editable email is the profile's CONTACT email; the sign-in
    // email is fixed to the Firebase account.
    email: user.contactEmail ?? user.email,
    contactNumber: user.contactNumber,
    facebookName: user.facebookName ?? "",
    occupation: user.occupation ?? "",
    completeAddress: user.completeAddress,
  };
}

/**
 * Maps the form back to the backend's profile columns, sending only what
 * changed. A re-typed full name is split into first/last(/suffix); an
 * edited address replaces addressLine1 and clears the granular PH
 * columns so the stored address never mixes old and new parts.
 */
function toChangedFields(
  values: PersonalInfoFormValues,
  user: User
): ProfileFields {
  const fields: ProfileFields = {};
  if (values.fullName.trim() !== user.fullName) {
    const { firstName, lastName, suffix } = splitFullName(values.fullName);
    fields.firstName = firstName;
    fields.lastName = lastName;
    if (suffix) fields.suffix = suffix;
  }
  if (values.email.trim() !== (user.contactEmail ?? user.email)) {
    fields.contactEmail = values.email.trim();
  }
  if (values.contactNumber.trim() !== user.contactNumber) {
    fields.phoneNumber = values.contactNumber.trim();
  }
  if (values.facebookName.trim() !== (user.facebookName ?? "")) {
    fields.facebookName = values.facebookName.trim();
  }
  if (values.occupation.trim() !== (user.occupation ?? "")) {
    fields.occupation = values.occupation.trim();
  }
  if (values.completeAddress.trim() !== user.completeAddress) {
    fields.addressLine1 = values.completeAddress.trim();
    fields.barangay = "";
    fields.cityMunicipality = "";
    fields.province = "";
    fields.region = "";
    fields.postalCode = "";
  }
  return fields;
}

export default function PersonalInfoPage() {
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
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
  } = useForm<PersonalInfoFormValues>({
    resolver: zodResolver(personalInfoSchema),
    defaultValues: {
      fullName: "",
      email: "",
      contactNumber: "",
      facebookName: "",
      occupation: "",
      completeAddress: "",
    },
  });

  useEffect(() => {
    if (user) reset(toFormValues(user));
  }, [user, reset]);

  // Accounts whose onboarding has not created the customer profile yet
  // land straight in edit mode so the first save can create it; once the
  // profile appears (created here or by the onboarding draft), the page
  // returns to the read-only view — unless the user opened editing.
  const autoEditingRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (!user.hasProfile) {
      autoEditingRef.current = true;
      setEditing(true);
    } else if (autoEditingRef.current) {
      autoEditingRef.current = false;
      setEditing(false);
    }
  }, [user]);

  // The success confirmation disappears on its own after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!user) return null;

  const hasUnsavedChanges = isDirty || avatarPreview !== null;

  function startEditing() {
    if (user) reset(toFormValues(user));
    clearSelection();
    setSaved(false);
    setEditing(true);
  }

  function exitEditing() {
    if (user) reset(toFormValues(user));
    clearSelection();
    setEditing(false);
  }

  function cancelEditing() {
    if (hasUnsavedChanges) {
      setLeaveOpen(true);
      return;
    }
    exitEditing();
  }

  async function onSubmit(values: PersonalInfoFormValues) {
    if (!user || saving) return;
    setServiceError(null);
    setSaving(true);
    try {
      if (user.hasProfile) {
        const fields = toChangedFields(values, user);
        if (Object.keys(fields).length > 0) {
          await updateMyProfile(fields);
        }
      } else {
        // First save creates the profile (issues the DAPG number). The
        // backend claims a matching historical profile automatically.
        const { firstName, lastName, suffix } = splitFullName(values.fullName);
        const fields: ProfileFields = {
          firstName,
          lastName,
          contactEmail: values.email.trim(),
          phoneNumber: values.contactNumber.trim(),
          addressLine1: values.completeAddress.trim(),
        };
        if (suffix) fields.suffix = suffix;
        if (values.facebookName.trim()) {
          fields.facebookName = values.facebookName.trim();
        }
        if (values.occupation.trim()) {
          fields.occupation = values.occupation.trim();
        }
        await createMyProfile(fields);
      }
      if (avatarFile) {
        await uploadProfileImage(avatarFile);
      }
      await refreshUser();
      clearSelection();
      setEditing(false);
      setSaved(true);
    } catch (error) {
      setServiceError(
        errorMessage(error, "Unable to save your profile. Please try again.")
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      // Bottom padding keeps the profile clear of the footer: the (portal)
      // layout already adds 60px below lg, topped up to >=64px from md;
      // at lg the page carries the full 80px itself.
      className="md:pb-[16px] lg:flex lg:min-h-[907px] lg:items-start lg:pb-[80px]"
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
        editing={editing}
        onChangePhoto={editing ? openPicker : undefined}
      >
        {editing ? (
          <>
            {avatarError && (
              <p className="text-center text-[15px] leading-normal text-[#c00] lg:text-left">
                {avatarError}
              </p>
            )}
            {avatarPreview && (
              <button
                type="button"
                onClick={clearSelection}
                className="cursor-pointer text-center text-[15px] leading-normal text-[#c00] underline lg:text-left"
              >
                Remove selected photo
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className={`${DARK_BUTTON} disabled:opacity-60`}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className={OUTLINE_BUTTON}
            >
              Cancel Edit
            </button>
            {serviceError && (
              <p
                role="alert"
                className="text-center text-[15px] leading-normal text-[#c00] lg:text-left"
              >
                {serviceError}
              </p>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={startEditing} className={DARK_BUTTON}>
              Edit Info
            </button>
            {saved && (
              <p
                role="status"
                className="text-center text-[15px] font-semibold leading-normal text-[#188038] lg:text-left"
              >
                Profile updated successfully.
              </p>
            )}
          </>
        )}
      </ProfileAvatarColumn>

      <section className="mt-[40px] min-w-0 flex-1 lg:ml-[44px] lg:mr-[42px] lg:mt-[45px]">
        <h1 className="text-[24px] font-semibold leading-normal text-black">
          Personal Information
        </h1>

        {!user.hasProfile && (
          <p className="mt-[12px] max-w-[849px] rounded-[10px] bg-[rgba(204,0,0,0.08)] px-[16px] py-[10px] text-[15px] leading-normal text-[#8a1f1f]">
            Your customer profile has not been set up yet. Fill in your
            details and press Save Changes to complete it.
          </p>
        )}

        <div className="mt-[20px] grid max-w-[849px] grid-cols-1 gap-x-[8px] gap-y-[20px] lg:grid-cols-2">
          {editing ? (
            <>
              <FormField
                label="Full Name"
                registration={register("fullName")}
                error={errors.fullName?.message}
              />
              <FormField
                label="Email"
                registration={register("email")}
                error={errors.email?.message}
              />
              <FormField
                label="Contact Number"
                registration={register("contactNumber")}
                error={errors.contactNumber?.message}
              />
              <FormField
                label="Facebook Name"
                registration={register("facebookName")}
                error={errors.facebookName?.message}
              />
              <FormField
                label="Occupation"
                registration={register("occupation")}
                error={errors.occupation?.message}
              />
              <FormField
                label="Complete Address"
                registration={register("completeAddress")}
                error={errors.completeAddress?.message}
                className="lg:col-span-2"
              />
            </>
          ) : (
            <>
              <ReadOnlyField label="Full Name" value={user.fullName} />
              <ReadOnlyField
                label="Email"
                value={user.contactEmail ?? user.email}
              />
              <ReadOnlyField label="Contact Number" value={user.contactNumber} />
              <ReadOnlyField
                label="Facebook Name"
                value={user.facebookName ?? ""}
              />
              <ReadOnlyField label="Occupation" value={user.occupation ?? ""} />
              <ReadOnlyField
                label="Complete Address"
                value={user.completeAddress}
                className="lg:col-span-2"
              />
            </>
          )}
        </div>

      </section>

      <LeaveFormDialog
        open={leaveOpen}
        onStay={() => setLeaveOpen(false)}
        onLeave={() => {
          setLeaveOpen(false);
          exitEditing();
        }}
      />
    </form>
  );
}
