import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";

// The PS and F1 order forms require an authenticated customer session
// (chick ordering additionally requires completed seminar modules — the
// eligibility gate runs after this auth guard).
export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <VerifyEmailBanner />
      {children}
    </ProtectedRoute>
  );
}
