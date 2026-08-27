"use client";

// Figma: Booking Confirmed dialog (252:2336) — consultancy booking confirmation.
// Rendered at 0.75 scale: 1175x656 -> 881x492 (top padding 156 -> 117,
// bottom 155 -> 116), check mark 142x141 -> 107x106, title 40 -> 30,
// body 24 -> 18.

interface BookingConfirmedModalProps {
  onClose: () => void;
}

export function BookingConfirmedModal({ onClose }: BookingConfirmedModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(24,24,24,0.6)] px-[24px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-confirmed-title"
    >
      <div className="relative w-full max-w-[881px] overflow-clip rounded-[15px] bg-white">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-[24px] top-[24px] block cursor-pointer lg:right-[39px] lg:top-[37px]"
        >
          <img
            src="/figma/icon-close-large.svg"
            alt=""
            className="size-[17px]"
          />
        </button>
        <div className="flex flex-col items-center px-[24px] pb-[80px] pt-[80px] lg:pb-[116px] lg:pt-[117px]">
          <div className="relative h-[106px] w-[107px] overflow-hidden">
            <img
              src="/figma/booking-confirmed-check.png"
              alt=""
              className="absolute left-[-17.51%] top-[-10.21%] h-[120.47%] w-[127.2%] max-w-none"
            />
          </div>
          <p
            id="booking-confirmed-title"
            className="mt-[40px] text-center text-[26px] font-semibold leading-normal text-black lg:mt-[41px] lg:text-[30px]"
          >
            Booking Confirmed!
          </p>
          <p className="mt-[24px] max-w-[599px] text-center text-[16px] leading-normal text-black lg:mt-[33px] lg:text-[18px]">
            Your consultancy booking has been submitted. Our team will confirm
            your appointment within 24 hours via email or SMS.
          </p>
        </div>
      </div>
    </div>
  );
}
