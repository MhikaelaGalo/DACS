"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { IdleSignOutGuard } from "@/components/layout/IdleSignOutGuard";
import { Sidebar } from "@/components/layout/Sidebar";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ToastProvider } from "@/components/ui/Toast";
import {
  getSession,
  ROLE_LABELS,
  setSessionRole,
  signOut,
  type StaffSession,
} from "@/lib/auth";
import { refreshPermissionCache } from "@/lib/api/permissions";
import { getCurrentFirebaseUser } from "@/lib/firebase";
import { roleHasAccess, type PermissionModule } from "@/lib/permissions";

const SECTION_MODULES: Record<string, PermissionModule> = {
  dashboard: "Dashboard",
  customers: "Customer Information",
  forms: "Forms",
  historical: "Historical Data",
  settings: "Settings",
};

const PAGE_NAMES: Record<string, string> = {
  forms: "the Forms page",
  historical: "Historical Data",
  dashboard: "the Dashboard",
  customers: "Customer Information",
  settings: "Settings",
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [checked, setChecked] = useState(false);

  /*
   * Page gating reads the cached permission matrix synchronously; the
   * cache itself is server truth, refreshed once per app load (and by
   * the Settings matrix after every change).
   */
  useEffect(() => {
    void refreshPermissionCache();
  }, []);

  useEffect(() => {
    const current = getSession();
    if (!current) {
      router.replace("/sign-in");
      return;
    }
    setSession(current);
    setChecked(true);

    /*
     * The cached session must be backed by a live Firebase user — API
     * calls need its ID token. If Firebase lost the sign-in (cleared
     * site data, revoked account), drop the stale cache and re-enter
     * through the sign-in flow.
     */
    let cancelled = false;
    void getCurrentFirebaseUser().then((user) => {
      if (cancelled || user) return;
      signOut();
      router.replace("/sign-in");
    });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (!checked || !session) {
    return null;
  }

  /*
   * Access is driven by the Roles and Permission matrix in Settings, so
   * granting Staff the Forms module there immediately unlocks the page.
   */
  const section = pathname.split("/")[1] ?? "";
  const permissionModule = SECTION_MODULES[section];
  const restricted =
    permissionModule !== undefined &&
    !roleHasAccess(ROLE_LABELS[session.role], permissionModule);

  return (
    <ToastProvider>
      <IdleSignOutGuard />
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {restricted ? (
            <AccessDenied
              pageName={PAGE_NAMES[section] ?? "this page"}
              onRoleSelected={(role) => setSession(setSessionRole(role))}
            />
          ) : (
            children
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
