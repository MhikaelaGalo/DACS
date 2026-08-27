// Figma status chips (Order History 255:4190 and the receipt frames):
// Delivered = green, Shipped = blue, Processing = yellow. The remaining
// labels come from the backend order lifecycle and reuse the palette.
const STATUS_STYLES: Record<string, string> = {
  Delivered: "bg-[#bfffb4] text-[#148200]",
  Shipped: "bg-[#c6dcff] text-[#074ab7]",
  Processing: "bg-[#fff1bf] text-[#9a7800]",
  Approved: "bg-[#c6dcff] text-[#074ab7]",
  "Payment Under Review": "bg-[#fff1bf] text-[#9a7800]",
  "Payment Verified": "bg-[#bfffb4] text-[#148200]",
  Rejected: "bg-[#ffd6d6] text-[#a11212]",
  Cancelled: "bg-[#ffd6d6] text-[#a11212]",
};

export function OrderStatusBadge({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? "bg-[#d4d4d4] text-[#222]";
  return (
    <span
      className={`flex h-[28px] items-center justify-center whitespace-nowrap rounded-[15px] px-[17px] text-[12px] leading-normal ${style} ${className}`}
    >
      {status}
    </span>
  );
}
