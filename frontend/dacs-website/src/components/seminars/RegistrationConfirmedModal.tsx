"use client";

// Figma: Seminar Registration confirmation dialog (252:450), rendered at
// 0.75 scale: modal 1175 -> 881 wide, check icon 142 -> 107, title 40 -> 30,
// body 24 -> 18.

interface RegistrationConfirmedModalProps {
  onClose: () => void;
}

export function RegistrationConfirmedModal({
  onClose,
}: RegistrationConfirmedModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(24,24,24,0.6)] px-[24px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registration-confirmed-title"
    >
      <div className="relative w-full max-w-[881px] overflow-clip rounded-[15px] bg-white">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-[24px] top-[24px] block cursor-pointer lg:right-[39px] lg:top-[37px]"
        >
          <img src="/figma/icon-close.svg" alt="" className="size-[16px]" />
        </button>
        {/* Figma 252:450: 141px above the check icon and 141px below the body
            text inside the 656px-tall dialog -> 106px at 0.75. */}
        <div className="flex flex-col items-center px-[24px] pb-[80px] pt-[80px] lg:pb-[106px] lg:pt-[106px]">
          <img
            src="/figma/icon-check-circle.png"
            alt=""
            className="h-[106px] w-[107px] object-contain"
          />
          <p
            id="registration-confirmed-title"
            className="mt-[41px] text-center text-[26px] font-semibold leading-normal text-black lg:text-[30px]"
          >
            Registration Confirmed!
          </p>
          <p className="mt-[32px] max-w-[599px] text-center text-[16px] leading-normal text-black lg:text-[18px]">
            You are now enrolled in the selected module(s). You can
            start watching the seminar videos anytime from the seminar page.
          </p>
        </div>
      </div>
    </div>
  );
}
