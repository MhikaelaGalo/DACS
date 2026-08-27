export function formatPeso(value: number): string {
  return `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 0 })}`;
}

/* Business acronyms that must stay fully capitalized in labels. */
const LABEL_ACRONYMS = new Set(["LBC"]);

/*
 * Display formatter for technical enum tokens: PAYMENT_VERIFIED ->
 * "Payment Verified", PARENT_STOCK -> "Parent Stock", under_review ->
 * "Under Review". DISPLAY ONLY — the raw value stays what the backend
 * groups and filters on.
 *
 * Deliberately conservative so it can never mangle exact values:
 * anything that is not a single-cased letter/digit token chain
 * (mixed-case text, spaces, punctuation, emails, "2026-06", DAPG
 * numbers with no letters after the digits rule, free text) passes
 * through unchanged. Callers additionally gate on the analytics
 * catalog's per-field `enumLike` flag, so product names, codes, IDs
 * and geography are never routed here in the first place.
 */
export function formatEnumLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  /*
   * Letters/digits joined by underscores only. Hyphenated values are
   * deliberately NOT transformed: no DACS enum contains a hyphen,
   * while product codes (VET-ADECTROL-1L), DAPG numbers and quarter
   * buckets (2026-Q3) do — those must survive verbatim even if this
   * formatter is ever called on them directly.
   */
  if (!/^[A-Za-z0-9]+(_[A-Za-z0-9]+)*$/.test(trimmed)) return trimmed;
  /* Purely numeric tokens are data, not labels. */
  if (!/[A-Za-z]/.test(trimmed)) return trimmed;
  /* Mixed-case values ("Unspecified", "Bulacan") are already authored. */
  if (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed)) return trimmed;
  return trimmed
    .split(/_+/)
    .map((word) =>
      LABEL_ACRONYMS.has(word.toUpperCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-PH");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* "2026-06-27" -> "6/27/2026" (quotation payment-due style). */
export function formatSlashDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return `${month}/${day}/${year}`;
}

/* "2025-05-13" -> "May 13, 2025" (OQ Date style). */
export function formatLongDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/* "2026-08" -> "Aug" for chart axes. */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-PH", {
    month: "short",
  });
}
