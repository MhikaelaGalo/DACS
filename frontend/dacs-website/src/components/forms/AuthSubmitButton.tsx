"use client";

interface AuthSubmitButtonProps
  extends React.ComponentPropsWithoutRef<"button"> {
  children: React.ReactNode;
}

// Figma: dark auth submit button at 0.75 scale — bg #181818, 85px tall -> 64px,
// radius 20 -> 15, shadow 20 -> 15, bold 24px -> 18px #f4f4f4 label, full form width.
export function AuthSubmitButton({
  className = "",
  children,
  ...props
}: AuthSubmitButtonProps) {
  return (
    <button
      type="submit"
      className={`flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] text-[18px] font-bold leading-normal text-[#f4f4f4] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
