/**
 * Formats a number as Philippine pesos without decimals, exactly as shown in
 * the Figma account frames (e.g. 9000 -> "₱9,000", 700 -> "₱700").
 */
export function formatPeso(amount: number): string {
  return `₱${amount.toLocaleString("en-PH")}`;
}
