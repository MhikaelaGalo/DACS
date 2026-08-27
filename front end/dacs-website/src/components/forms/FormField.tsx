"use client";

interface FormFieldProps extends React.ComponentPropsWithRef<"input"> {
  label: string;
  /** Shows the red required asterisk after the label (Figma /figma/icon-asterisk.svg). */
  showAsterisk?: boolean;
  error?: string;
  containerClassName?: string;
}

// Figma: auth input at 0.75 scale — 24px -> 18px label (red superscript
// asterisk when required) above a 71px -> 53px tall, #181818-bordered,
// 15px -> 11px radius input.
export function FormField({
  label,
  showAsterisk = false,
  error,
  containerClassName = "",
  id,
  className = "",
  ...inputProps
}: FormFieldProps) {
  const inputId = id ?? (inputProps.name ? `field-${inputProps.name}` : undefined);

  return (
    <div className={containerClassName}>
      <label
        htmlFor={inputId}
        className="flex items-start gap-[7px] text-[18px] leading-normal text-black"
      >
        <span>{label}</span>
        {showAsterisk && (
          <img
            src="/figma/icon-asterisk.svg"
            alt=""
            aria-hidden
            className="h-[9px] w-[8px] -translate-y-[5px]"
          />
        )}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={`mt-[12px] h-[53px] w-full rounded-[11px] border border-[#181818] bg-transparent px-[16px] text-[18px] leading-normal text-black outline-none placeholder:font-light placeholder:italic placeholder:text-[#7d7d7d] lg:mt-[19px] lg:px-[19px] ${className}`}
        {...inputProps}
      />
      {error && (
        <p className="mt-[8px] text-[14px] leading-normal text-[#c00] lg:text-[12px]">
          {error}
        </p>
      )}
    </div>
  );
}
