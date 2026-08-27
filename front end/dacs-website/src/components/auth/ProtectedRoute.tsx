"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/AuthProvider";
import { signInHrefFor } from "@/lib/auth/routes";

// Client route guard for protected sections (account, seminars, ordering).
// Renders nothing until the session state is known, then either shows the
// protected content or redirects to Sign In preserving the destination —
// protected information is never flashed to signed-out visitors.
// TODO: Connect to Firebase Authentication for real server-side sessions.
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      // A just-signed-out customer goes to the public Home page; anyone else
      // reaching a protected route signed out goes to Sign In with returnTo.
      if (window.sessionStorage.getItem("dacs.signingOut")) {
        window.sessionStorage.removeItem("dacs.signingOut");
        router.replace("/");
        return;
      }
      router.replace(signInHrefFor(pathname));
    }
  }, [ready, user, pathname, router]);

  if (!ready || !user) return null;
  return <>{children}</>;
}
