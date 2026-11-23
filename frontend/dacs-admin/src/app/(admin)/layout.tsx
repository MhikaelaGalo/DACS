"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { IdleSignOutGuard } from "@/components/layout/IdleSignOutGuard";
import { Sidebar } from "@/components/layout/Sidebar";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ToastProvider } from "@/components/ui/Toast";
import {
  cacheStaffSession,
  fetchStaffSession,
  getSession,
  ROLE_LABELS,
  signOut,
  type StaffSession,
} from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { fetchPermissionMatrix } from "@/lib/api/permissions";
import { getCurrentFirebaseUser } from "@/lib/firebase";
import { DashboardEditingContext, type PermissionModule, type PermissionState } from "@/lib/permissions";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

const SECTION_MODULES: Record<string, PermissionModule> = {
  customers: "Customer Information",
  forms: "Forms",
  historical: "Historical Data",
  settings: "Settings",
};

const PAGE_NAMES: Record<string, string> = {
  forms: "the Forms page",
  historical: "Historical Data",
  customers: "Customer Information",
  settings: "Settings",
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/sign-in");
      return;
    }
    let cancelled = false;
    async function verifySession() {
      try {
        const user = await getCurrentFirebaseUser();
        if (cancelled) return;
        if (!user) throw new ApiError(401, "Sign-in required.");
        const verified = await fetchStaffSession(user.displayName);
        if (cancelled) return;
        // Replace any role saved by older versions before rendering admin pages.
        cacheStaffSession(verified);
        setSession(verified);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          signOut();
          router.replace("/sign-in");
        } else {
          setSessionError(true);
        }
      }
    }
    void verifySession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (sessionError) return <p className="p-6">Unable to verify your account. Refresh the page to try again.</p>;
  if (!session) return null;
  return <AdminShell session={session}>{children}</AdminShell>;
}

function AdminShell({ session, children }: { session: StaffSession; children: React.ReactNode }) {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  useAutoRefresh(async () => {
    try {
      setPermissions(await fetchPermissionMatrix());
      setPermissionError(false);
    } catch {
      setPermissionError(true);
    }
  }, 15_000);

  if (!permissions) {
    return <p className="p-6">{permissionError ? "Unable to load permissions. Retrying…" : "Loading permissions…"}</p>;
  }
  const role = ROLE_LABELS[session.role];
  const section = pathname.split("/")[1] ?? "";
  const permissionModule = SECTION_MODULES[section];
  const restricted =
    permissionModule !== undefined &&
    permissions.grants[permissionModule]?.[role] !== true;
  const canEditDashboard = !permissionError && permissions.grants.Dashboard?.[role] === true;

  return (
    <ToastProvider>
      <IdleSignOutGuard />
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {restricted ? (
            <AccessDenied pageName={PAGE_NAMES[section] ?? "this page"} />
          ) : (
            <DashboardEditingContext.Provider value={canEditDashboard}>
              {children}
            </DashboardEditingContext.Provider>
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
