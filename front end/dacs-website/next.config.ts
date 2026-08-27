import type { NextConfig } from "next";

/*
 * Baseline security response headers. Deliberately no Content-Security-
 * Policy: the customer site loads Firebase Auth, a Google Maps embed, and
 * cross-origin backend upload media, and a strict CSP would need careful
 * per-source tuning and a full build-verify (which this host cannot run).
 * These headers are safe, broadly-supported defaults that add clickjacking,
 * MIME-sniff, and referrer protections without touching resource loading.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
