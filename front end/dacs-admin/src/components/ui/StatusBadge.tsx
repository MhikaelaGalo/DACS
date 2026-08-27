/*
 * Status chips per the mockups. Color is never the only signal — the
 * status text is always inside the chip.
 */
const BADGE_STYLES: Record<string, string> = {
  // Orders
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-700",
  PAYMENT_SUBMITTED: "bg-amber-100 text-amber-800",
  PAYMENT_VERIFIED: "bg-green-100 text-green-800",
  PROCESSING: "bg-amber-100 text-amber-800",
  SHIPPED: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  // Seminars
  "In Progress": "bg-amber-100 text-amber-800",
  Completed: "bg-green-100 text-green-800",
  Failed: "bg-red-100 text-red-700",
  // Order tracking (title-case variants from the mockups)
  Processing: "bg-amber-100 text-amber-800",
  Shipped: "bg-blue-100 text-blue-800",
  Delivered: "bg-green-100 text-green-800",
  // Breeders
  ACTIVE: "bg-green-100 text-green-800",
  EXPIRED: "bg-red-100 text-red-700",
  INELIGIBLE: "bg-gray-200 text-gray-700",
  // Payments
  VERIFIED: "bg-green-100 text-green-800",
  // Tickets
  SUBMITTED: "bg-amber-100 text-amber-800",
  UNDER_REVIEW: "bg-blue-100 text-blue-800",
  RESPONDED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-200 text-gray-700",
  // Accounts
  SUSPENDED: "bg-amber-100 text-amber-800",
  DISABLED: "bg-gray-200 text-gray-700",
  // Historical source records (validation)
  VALID: "bg-green-100 text-green-800",
  PARTIAL: "bg-amber-100 text-amber-800",
  NEEDS_REVIEW: "bg-orange-100 text-orange-800",
  INVALID: "bg-red-100 text-red-700",
  // Issued certificates (validity derived from validUntil)
  NOT_ISSUED: "bg-gray-200 text-gray-700",
};

const BADGE_LABELS: Record<string, string> = {
  PAYMENT_SUBMITTED: "Payment Submitted",
  PAYMENT_VERIFIED: "Payment Verified",
  UNDER_REVIEW: "Under Review",
  NEEDS_REVIEW: "Needs Review",
};

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: { status: string }) {
  const style = BADGE_STYLES[status] ?? "bg-gray-100 text-gray-700";
  const label =
    BADGE_LABELS[status] ??
    (status === status.toUpperCase() ? toTitleCase(status) : status);

  return (
    <span
      className={`inline-block rounded-full px-3.5 py-1 text-sm font-medium ${style}`}
    >
      {label}
    </span>
  );
}
