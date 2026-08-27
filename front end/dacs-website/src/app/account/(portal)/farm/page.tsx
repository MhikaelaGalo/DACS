"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DARK_BUTTON } from "@/components/profile/buttons";
import { ReadOnlyField } from "@/components/profile/ProfileField";
import { ProfileAvatarColumn } from "@/components/profile/ProfileAvatarColumn";
import { useAuth } from "@/components/providers/AuthProvider";

// Figma: Farm Details view (255:3998). Read-only page — editing happens on
// the dedicated /account/farm/edit page (Figma 256:6599). After a save, the
// edit page returns here with ?updated=true, which briefly shows the
// success confirmation.
export default function FarmDetailsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  // Show the success message only when arriving from a completed save
  // (?updated=true), then clean the query string so the message never
  // reappears on refresh. window.location is read in the effect instead of
  // useSearchParams so the statically prerendered page needs no Suspense.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("updated") !== "true") return;
    setSaved(true);
    router.replace("/account/farm", { scroll: false });
    const timer = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [router]);

  if (!user) return null;

  return (
    <div className="lg:flex lg:items-start lg:pb-[60px]">
      <ProfileAvatarColumn avatarUrl={user.avatarUrl} alt={user.fullName}>
        <button
          type="button"
          onClick={() => router.push("/account/farm/edit")}
          className={DARK_BUTTON}
        >
          Edit Info
        </button>
        {saved && (
          <p
            role="status"
            className="text-center text-[15px] font-semibold leading-normal text-[#188038] lg:text-left"
          >
            Farm details updated successfully.
          </p>
        )}
      </ProfileAvatarColumn>

      <section className="mt-[40px] min-w-0 flex-1 lg:ml-[44px] lg:mr-[42px] lg:mt-[45px]">
        <h1 className="text-[24px] font-semibold leading-normal text-black">
          Farm Information
        </h1>

        {/* The primary farm from the DACS backend (session data). */}
        <div className="mt-[20px] flex max-w-[849px] flex-col gap-y-[20px]">
          <ReadOnlyField label="Farm Name" value={user.farmName ?? ""} />
          <ReadOnlyField label="Farm Address" value={user.farmAddress ?? ""} />
        </div>
        {!user.farmName && (
          <p className="mt-[16px] max-w-[849px] text-[15px] leading-normal text-[#7d7d7d]">
            No farm is registered yet — use Edit Info to add your farm
            details.
          </p>
        )}
      </section>
    </div>
  );
}
