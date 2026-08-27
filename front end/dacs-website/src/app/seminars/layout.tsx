import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";

// Every seminar route (listing, registration, modules, exam, certificate)
// requires an authenticated customer session.
export default function SeminarsLayout({
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
