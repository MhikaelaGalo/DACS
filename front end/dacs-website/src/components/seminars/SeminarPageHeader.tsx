import Link from "next/link";
import { FormCloseButton } from "@/components/ui/FormCloseButton";

// Figma: shared header of the module seminar pages (262:2, 290:626, 305:2),
// rendered at 0.75 scale in a 1440px container — back arrow, red "Seminar"
// eyebrow + module title, and the Videos > Exam > Certificate stepper
// (circles 63 -> 47, labels 24 -> 18, label widths 110/92/131 -> 83/69/98).

const STEPS = [
  { number: 1, label: "Videos  >", labelWidth: 83 },
  { number: 2, label: "Exam  >", labelWidth: 69 },
  { number: 3, label: "Certificate", labelWidth: 98 },
] as const;

interface SeminarPageHeaderProps {
  title: string;
  activeStep: 1 | 2 | 3;
  backHref: string;
  /** When set, renders an X close button in the container's upper-left that exits to this route. */
  closeHref?: string;
  closeLabel?: string;
  closeHasUnsavedChanges?: boolean;
}

export function SeminarPageHeader({
  title,
  activeStep,
  backHref,
  closeHref,
  closeLabel,
  closeHasUnsavedChanges = false,
}: SeminarPageHeaderProps) {
  return (
    <div
      className={`relative mx-auto max-w-[1440px] px-[20px] lg:px-0 lg:pt-0 ${
        closeHref ? "pt-[64px]" : "pt-[32px]"
      }`}
    >
      {closeHref && (
        <FormCloseButton
          fallbackHref={closeHref}
          hasUnsavedChanges={closeHasUnsavedChanges}
          ariaLabel={closeLabel ?? "Close"}
          className="left-[12px] top-[12px] lg:left-[46px] lg:top-[28px]"
        />
      )}
      <Link
        href={backHref}
        aria-label="Back"
        className="mb-[16px] inline-block lg:absolute lg:left-[54px] lg:top-[95px] lg:mb-0"
      >
        <img
          src="/figma/icon-arrow-back.svg"
          alt=""
          className="h-[23px] w-[21px]"
        />
      </Link>
      <div className="flex flex-col gap-[24px] lg:flex-row lg:items-start lg:justify-between lg:pl-[137px] lg:pr-[90px] lg:pt-[43px]">
        <div>
          <p className="text-[18px] font-semibold leading-normal text-[#c00]">
            Seminar
          </p>
          <h1 className="mt-[7px] text-[26px] font-semibold leading-normal text-black lg:w-[565px] lg:text-[30px]">
            {title}
          </h1>
        </div>
        <div className="flex shrink-0 items-center overflow-x-auto lg:mt-[14px]">
          {STEPS.map((step, i) => {
            const active = step.number === activeStep;
            return (
              <div
                key={step.number}
                className={`flex items-center ${i > 0 ? "ml-[26px] lg:ml-[35px]" : ""}`}
              >
                <div
                  className={`flex size-[40px] shrink-0 items-center justify-center rounded-full lg:size-[47px] ${
                    active ? "bg-[#181818]" : "bg-[#d9d9d9]"
                  }`}
                >
                  <span
                    className={`text-[16px] font-bold leading-normal lg:text-[18px] ${
                      active ? "text-white" : "text-[#767676]"
                    }`}
                  >
                    {step.number}
                  </span>
                </div>
                <p
                  className={`ml-[12px] whitespace-pre text-center text-[15px] font-bold leading-normal lg:ml-[16px] lg:text-[18px] ${
                    active ? "text-black" : "text-[#9f9e9e]"
                  }`}
                  style={{ width: `${step.labelWidth}px` }}
                >
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
