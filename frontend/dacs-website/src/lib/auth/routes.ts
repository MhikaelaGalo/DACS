// Centralized route-access rules for the DACS customer site.
// TODO: Connect to Firebase Authentication — server-side enforcement will
// replace these client guards once real sessions exist.

/** Pages a signed-out visitor may browse. */
export const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/products",
  "/sign-in",
  "/register",
  "/forgot-password",
];

/** Everything under these prefixes requires an authenticated session. */
export const PROTECTED_ROUTE_PREFIXES = [
  "/account",
  "/seminars",
  "/order",
  "/cart",
  "/checkout",
  "/orders",
];

/**
 * Only same-site paths may be used as post-sign-in destinations — never
 * external URLs (e.g. "https://evil.example" or "//evil.example").
 */
export function validateReturnToRoute(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

/** Builds the sign-in URL that returns to the given in-app destination. */
export function signInHrefFor(returnTo: string): string {
  return `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}
