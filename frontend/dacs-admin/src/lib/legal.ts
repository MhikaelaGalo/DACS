/*
 * The DACS legal documents live only on the customer website
 * (front end/dacs-website: /privacy-policy and /terms-and-conditions) so
 * there is a single canonical copy of each. The admin app links to them
 * cross-origin; the customer site's base URL comes from
 * NEXT_PUBLIC_CUSTOMER_SITE_URL (production) with a localhost fallback
 * matching the website's dev/start port.
 */
const CUSTOMER_SITE_URL = (
  process.env.NEXT_PUBLIC_CUSTOMER_SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");

export const PRIVACY_POLICY_URL = `${CUSTOMER_SITE_URL}/privacy-policy`;
export const TERMS_AND_CONDITIONS_URL = `${CUSTOMER_SITE_URL}/terms-and-conditions`;
