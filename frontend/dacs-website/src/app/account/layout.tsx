import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";

// Every customer-account route (profile, farm, forms, tickets, modules,
// orders, security, certificates) requires an authenticated session.
export default function AccountLayout({
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
