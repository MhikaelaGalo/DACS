"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Footer } from "@/components/layout/Footer";
import { ProfileSidebar } from "@/components/profile/ProfileSidebar";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";

// Figma: shared account shell (sidebar + content) used by the User Info,
// Farm Details, Modules Taken, Order History and Security frames.
// The Forms page (203:50) and the Certificate view (368:9) do not show the
// sidebar, so they live outside this route group.
export default function AccountPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.replace(ROUTES.signIn);
  }, [ready, user, router]);

  return (
    // Fills the root <main> flex column so the footer is always the page's
    // last visible element — short pages (e.g. Farm Details) stretch the
    // content area instead of leaving a white strip below the footer. The
    // footer itself stays in normal document flow.
    <div className="flex flex-1 flex-col bg-white">
      <div className="mx-auto w-full max-w-[1440px] flex-1 px-[20px] pb-[60px] pt-[40px] lg:flex lg:items-start lg:px-0 lg:pb-0 lg:pt-0">
        <ProfileSidebar className="lg:ml-[65px] lg:mt-[65px] lg:w-[173px] lg:shrink-0" />
        <div className="mt-[40px] min-w-0 flex-1 lg:mt-0">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
