import type { UseFormRegisterReturn } from "react-hook-form";

// Figma account-section fields (1920 frame, rendered at 0.75 scale):
// label 24 -> 18, gap 26 -> 20, box 71 rounded-[15px] -> 53 rounded-[11px].
// Read-only boxes are gray (#d4d4d4); editable inputs are white unless the
// frame shows otherwise (Security keeps the gray fill in edit mode).

export function ReadOnlyField({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[18px] leading-normal text-black">{label}</p>
      <div className="mt-[20px] flex h-[53px] items-center rounded-[11px] border border-[#181818] bg-[#d4d4d4] px-[20px]">
        <span className="truncate text-[18px] leading-normal text-[#222]">
          {value}
        </span>
      </div>
    </div>
  );
}

export function FormField({
  label,
  registration,
  error,
  type = "text",
  placeholder,
  inputClassName = "bg-white",
  className = "",
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: string;
  placeholder?: string;
  inputClassName?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block">
        <span className="block text-[18px] leading-normal text-black">
          {label}
        </span>
        <input
          type={type}
          placeholder={placeholder}
          {...registration}
          className={`mt-[20px] block h-[53px] w-full rounded-[11px] border border-[#181818] px-[20px] text-[18px] leading-normal text-[#222] outline-none placeholder:text-[#222] ${inputClassName}`}
        />
      </label>
      {error && (
        <p className="mt-2 text-[12px] leading-normal text-[#c00]">{error}</p>
      )}
    </div>
  );
}
