"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Footer } from "@/components/layout/Footer";
import { RegistrationConfirmedModal } from "@/components/seminars/RegistrationConfirmedModal";
import { FormCloseButton } from "@/components/ui/FormCloseButton";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/components/providers/AuthProvider";
import { errorMessage } from "@/lib/api";
import { updateMyProfile, type ProfileFields } from "@/lib/api/account";
import {
  seminarRegistrationSchema,
  type SeminarRegistrationFormValues,
} from "@/lib/validation/seminar";
import { splitFullName } from "@/services/auth.service";
import {
  enrollInModules,
  fetchSeminarViews,
  type SeminarView,
} from "@/services/seminar.service";

// Figma: Seminar Registration page — re-enrollee "Yes" (252:124) and "No"
// (252:2206) states, the Yes/No dropdown (252:463) and the confirmation
// dialog (252:450) — rendered at 0.75 scale: form panel 1730 -> 1298 wide,
// inputs 71 -> 53 tall, labels 24 -> 18, module cards 139 -> 104 tall.

function RequiredLabel({ text, bold }: { text: string; bold?: boolean }) {
  return (
    <div className="flex items-start gap-[8px]">
      <span
        className={`whitespace-nowrap text-[18px] leading-normal text-black ${bold ? "font-bold" : ""}`}
      >
        {text}
      </span>
      <img
        src="/figma/icon-asterisk.svg"
        alt="required"
        className="mt-[3px] h-[9px] w-[8px]"
      />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-[5px] text-[12px] leading-normal text-[#c00]">{message}</p>;
}

const INPUT_CLASSES =
  "mt-[23px] h-[53px] w-full rounded-[11px] border border-[#181818] bg-white px-[15px] text-[18px] leading-normal text-black outline-none";

// Opens the native date picker from a click anywhere inside the field. The
// native calendar-picker-indicator (normally the only click target that opens
// the calendar in Chrome/Edge) is hidden via CSS, so the whole field is the
// trigger instead.
function openDatePicker(e: React.MouseEvent<HTMLInputElement>) {
  const input = e.currentTarget;
  if (input.disabled) return;
  try {
    input.showPicker();
  } catch {
    // Browsers without showPicker() (older Safari) still focus the field so
    // the date can be typed or picked through the platform UI.
    input.focus();
  }
}

export default function SeminarRegistrationPage() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [reEnrolleeOpen, setReEnrolleeOpen] = useState(false);
  const [views, setViews] = useState<SeminarView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const reEnrolleeRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isDirty },
  } = useForm<SeminarRegistrationFormValues>({
    resolver: zodResolver(seminarRegistrationSchema),
    defaultValues: {
      fullName: "",
      email: "",
      contactNumber: "",
      gender: "",
      facebookName: "",
      occupation: "",
      homeFarmAddress: "",
      country: "",
      isReEnrollee: true,
      module2DateCompleted: "",
      module3DateCompleted: "",
      // No module is preselected — the farmer must choose one explicitly
      // (the Figma frame's ticked Module 2 is a filled-in example state).
      seminarIds: [],
    },
  });

  const isReEnrollee = watch("isReEnrollee");
  const seminarIds = watch("seminarIds");

  // Live module cards from the backend catalog.
  useEffect(() => {
    let cancelled = false;
    fetchSeminarViews()
      .then((result) => {
        if (!cancelled) setViews(result);
      })
      .catch(() => {
        /* Submit reports the problem if the catalog is unreachable. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefill the identity fields from the signed-in profile (they remain
  // editable; mappable edits are saved back to the profile on submit).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!user || prefilled.current) return;
    prefilled.current = true;
    reset({
      fullName: user.fullName,
      email: user.contactEmail ?? user.email,
      contactNumber: user.contactNumber,
      gender: "",
      facebookName: user.facebookName ?? "",
      occupation: user.occupation ?? "",
      homeFarmAddress: user.completeAddress,
      country: "Philippines",
      isReEnrollee: false,
      module2DateCompleted: "",
      module3DateCompleted: "",
      seminarIds: [],
    });
  }, [user, reset]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        reEnrolleeRef.current &&
        !reEnrolleeRef.current.contains(e.target as Node)
      ) {
        setReEnrolleeOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function chooseReEnrollee(value: boolean) {
    setValue("isReEnrollee", value, { shouldValidate: true, shouldDirty: true });
    setReEnrolleeOpen(false);
  }

  function toggleSeminar(id: string) {
    const next = seminarIds.includes(id)
      ? seminarIds.filter((s) => s !== id)
      : [...seminarIds, id];
    setValue("seminarIds", next, { shouldValidate: true, shouldDirty: true });
  }

  const onSubmit = async (values: SeminarRegistrationFormValues) => {
    if (submitting) return;
    setServiceError(null);
    setSubmitting(true);
    try {
      const chosen = views.filter((view) => values.seminarIds.includes(view.id));
      if (chosen.length === 0) {
        setServiceError(
          "The seminar catalog is unavailable right now. Please try again later."
        );
        return;
      }
      // Save mappable identity edits back to the customer profile.
      // (Gender, country of residence and the re-enrollee answers have no
      // backend home yet — a schema decision pending with the client.)
      if (user?.hasProfile) {
        const fields: ProfileFields = {};
        if (values.fullName.trim() !== user.fullName) {
          const { firstName, lastName, suffix } = splitFullName(values.fullName);
          fields.firstName = firstName;
          fields.lastName = lastName;
          if (suffix) fields.suffix = suffix;
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
        if (values.homeFarmAddress.trim() !== user.completeAddress) {
          fields.addressLine1 = values.homeFarmAddress.trim();
          fields.barangay = "";
          fields.cityMunicipality = "";
          fields.province = "";
          fields.region = "";
          fields.postalCode = "";
        }
        if (Object.keys(fields).length > 0) {
          await updateMyProfile(fields);
          await refreshUser();
        }
      }
      // The real enrollment: one idempotent start per selected module.
      await enrollInModules(chosen);
      setConfirmed(true);
    } catch (error) {
      setServiceError(
        errorMessage(
          error,
          "Unable to submit the registration right now. Please try again."
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#181818]">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="relative mx-auto mt-[40px] w-[calc(100%-32px)] max-w-[1298px] rounded-[15px] bg-white pb-[60px] pt-[60px] lg:mt-[64px] lg:w-full lg:pb-[97px] lg:pt-[99px]"
      >
        <FormCloseButton
          fallbackHref={ROUTES.seminars}
          hasUnsavedChanges={isDirty}
          ariaLabel="Exit seminar registration"
          className="left-[12px] top-[12px] lg:left-[40px] lg:top-[36px]"
        />
        <h1 className="text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
          Seminar Registration
        </h1>

        <div className="px-[24px] lg:pl-[50px] lg:pr-[51px]">
          {/* Row 1: Full Name / Email / Contact Number / Gender */}
          <div className="mt-[48px] flex flex-col gap-[24px] lg:mt-[54px] lg:flex-row lg:gap-0">
            <div className="lg:w-[285px]">
              <RequiredLabel text="Full Name" />
              <input type="text" {...register("fullName")} className={INPUT_CLASSES} />
              <FieldError message={errors.fullName?.message} />
            </div>
            <div className="lg:ml-[20px] lg:w-[285px]">
              <RequiredLabel text="Email" />
              <input type="email" {...register("email")} className={INPUT_CLASSES} />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="lg:ml-[18px] lg:w-[285px]">
              <RequiredLabel text="Contact Number" />
              <input type="tel" {...register("contactNumber")} className={INPUT_CLASSES} />
              <FieldError message={errors.contactNumber?.message} />
            </div>
            <div className="lg:ml-[18px] lg:w-[285px]">
              <RequiredLabel text="Gender" />
              <input type="text" {...register("gender")} className={INPUT_CLASSES} />
              <FieldError message={errors.gender?.message} />
            </div>
          </div>

          {/* Row 2: Facebook / Occupation / Home / Country */}
          <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[38px] lg:flex-row lg:gap-0">
            <div className="lg:w-[264px]">
              <RequiredLabel text="Facebook/Messenger Name" />
              <input type="text" {...register("facebookName")} className={INPUT_CLASSES} />
              <FieldError message={errors.facebookName?.message} />
            </div>
            <div className="lg:ml-[21px] lg:w-[194px]">
              <RequiredLabel text="Occupation" />
              <input type="text" {...register("occupation")} className={INPUT_CLASSES} />
              <FieldError message={errors.occupation?.message} />
            </div>
            <div className="lg:ml-[21px] lg:w-[388px]">
              <RequiredLabel text="Home / Farm Address" />
              <input type="text" {...register("homeFarmAddress")} className={INPUT_CLASSES} />
              <FieldError message={errors.homeFarmAddress?.message} />
            </div>
            <div className="lg:ml-[21px] lg:w-[288px]">
              <RequiredLabel text="Current Residence Country" />
              <input type="text" {...register("country")} className={INPUT_CLASSES} />
              <FieldError message={errors.country?.message} />
            </div>
          </div>

          {/* Row 3: re-enrollee + module completion dates */}
          <div className="mt-[24px] flex flex-col gap-[24px] lg:mt-[38px] lg:flex-row lg:gap-0">
            <div ref={reEnrolleeRef} className="relative lg:w-[209px]">
              <div className="lg:pl-[7px]">
                <RequiredLabel text="Are you a re-enrollee?" />
              </div>
              <button
                type="button"
                onClick={() => setReEnrolleeOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={reEnrolleeOpen}
                className="relative mt-[19px] flex h-[53px] w-full cursor-pointer items-center justify-center rounded-[11px] border border-[#181818] bg-white"
              >
                <span className="text-[18px] leading-normal text-black">
                  {isReEnrollee ? "Yes" : "No"}
                </span>
                <img
                  src="/figma/icon-caret.svg"
                  alt=""
                  className="absolute right-[14px] top-1/2 h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                />
              </button>
              {reEnrolleeOpen && (
                <div className="absolute left-0 top-[calc(100%+5px)] z-20 w-[208px] rounded-[15px] bg-white pb-[32px] pt-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]">
                  <button
                    type="button"
                    onClick={() => chooseReEnrollee(true)}
                    className="block w-full cursor-pointer text-center text-[18px] leading-normal text-black"
                  >
                    Yes
                  </button>
                  <div className="mx-auto mt-[22px] h-px w-[182px] bg-[#d9d9d9]" />
                  <button
                    type="button"
                    onClick={() => chooseReEnrollee(false)}
                    className="mt-[22px] block w-full cursor-pointer text-center text-[18px] leading-normal text-black"
                  >
                    No
                  </button>
                </div>
              )}
            </div>
            <div className="lg:ml-[20px] lg:w-[244px]">
              <div className="lg:pl-[7px]">
                <RequiredLabel text="Module 2 Date Completed" />
              </div>
              <div className="relative mt-[19px]">
                <input
                  type="date"
                  disabled={!isReEnrollee}
                  {...register("module2DateCompleted")}
                  onClick={openDatePicker}
                  className="relative h-[53px] w-full cursor-pointer appearance-none rounded-[11px] border border-[#181818] bg-white px-[15px] pr-[36px] text-[15px] leading-normal text-black outline-none disabled:cursor-not-allowed disabled:bg-[#d4d4d4] [&::-webkit-calendar-picker-indicator]:hidden"
                />
                <img
                  src="/figma/icon-caret.svg"
                  alt=""
                  className="pointer-events-none absolute right-[14px] top-1/2 z-[1] h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                />
              </div>
              <FieldError message={errors.module2DateCompleted?.message} />
            </div>
            <div className="lg:ml-[26px] lg:w-[244px]">
              <div className="lg:pl-[7px]">
                <RequiredLabel text="Module 3 Date Completed" />
              </div>
              <div className="relative mt-[19px]">
                <input
                  type="date"
                  disabled={!isReEnrollee}
                  {...register("module3DateCompleted")}
                  onClick={openDatePicker}
                  className="relative h-[53px] w-full cursor-pointer appearance-none rounded-[11px] border border-[#181818] bg-white px-[15px] pr-[36px] text-[15px] leading-normal text-black outline-none disabled:cursor-not-allowed disabled:bg-[#d4d4d4] [&::-webkit-calendar-picker-indicator]:hidden"
                />
                <img
                  src="/figma/icon-caret.svg"
                  alt=""
                  className="pointer-events-none absolute right-[14px] top-1/2 z-[1] h-[10px] w-[12px] -translate-y-1/2 rotate-180"
                />
              </div>
              <FieldError message={errors.module3DateCompleted?.message} />
            </div>
          </div>

          {/* Select Module(s) */}
          <div className="mt-[40px] lg:mt-[42px]">
            <RequiredLabel text="Select Module(s)" bold />
          </div>
          {/* Figma: module cards are inset 115px from the panel's left edge but
              only 68px from its right edge (-> 86 / 51 at 0.75), so only the
              left side gets the extra 36px. */}
          <div className="mt-[23px] flex flex-col gap-[19px] lg:pl-[36px]">
            {views.length === 0 && (
              <p className="text-[15px] leading-normal text-[#7d7d7d]">
                Loading available modules...
              </p>
            )}
            {views.map((seminar) => {
              const selected = seminarIds.includes(seminar.id);
              return (
                <button
                  key={seminar.id}
                  type="button"
                  onClick={() => toggleSeminar(seminar.id)}
                  aria-pressed={selected}
                  className="relative flex w-full cursor-pointer flex-col justify-start rounded-[15px] bg-white text-left shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:h-[104px]"
                >
                  <img
                    src={
                      selected
                        ? "/figma/radio-checked.svg"
                        : "/figma/radio-empty.svg"
                    }
                    alt=""
                    className="absolute left-[20px] top-[26px] size-[28px] lg:left-[22px] lg:top-[39px] lg:size-[26px]"
                  />
                  <div className="py-[24px] pl-[64px] pr-[24px] lg:py-0 lg:pl-[69px] lg:pr-[18px]">
                    <p className="text-[16px] font-bold leading-normal text-black lg:pt-[26px] lg:text-[18px]">
                      {seminar.title}
                    </p>
                    <div className="mt-[12px] flex flex-wrap items-center gap-y-[6px]">
                      <div className="flex w-[107px] items-center gap-[8px]">
                        <img
                          src="/figma/icon-clock.svg"
                          alt=""
                          className="size-[15px] shrink-0"
                        />
                        <p className="text-[15px] font-medium leading-normal text-[#7d7d7d]">
                          {seminar.durationLabel}
                        </p>
                      </div>
                      <div className="flex items-center gap-[8px]">
                        <img
                          src="/figma/icon-person.svg"
                          alt=""
                          className="h-[15px] w-[14px] shrink-0"
                        />
                        <p className="text-[15px] font-medium leading-normal text-[#7d7d7d]">
                          {seminar.speaker}
                        </p>
                      </div>
                      {/* Module price ("Free" / "₱2,700"): paid modules are
                          purchased on the Seminars page through the cart. */}
                      <p
                        className={`ml-auto pr-[4px] text-[15px] font-semibold leading-normal ${
                          seminar.isFree ? "text-[#116530]" : "text-[#c00]"
                        }`}
                      >
                        {seminar.priceLabel}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <FieldError message={errors.seminarIds?.message} />

          <button
            type="submit"
            disabled={submitting}
            className="mt-[60px] flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60 lg:mt-[83px]"
          >
            <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
              {submitting ? "Submitting..." : "Submit Registration"}
            </span>
          </button>
          {serviceError && (
            <p
              role="alert"
              className="mt-[16px] text-center text-[16px] leading-normal text-[#c00]"
            >
              {serviceError}
            </p>
          )}
        </div>
      </form>

      <div className="h-[60px] lg:h-[62px]" />
      <Footer />

      {confirmed && (
        <RegistrationConfirmedModal
          onClose={() => {
            setConfirmed(false);
            router.push(ROUTES.seminars);
          }}
        />
      )}
    </div>
  );
}
