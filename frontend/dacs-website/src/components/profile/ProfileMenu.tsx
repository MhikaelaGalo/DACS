"use client";

// Figma: User Profile dropdown (203:69) — opens from the navbar avatar.
// Rendered at 0.75 scale: 478px wide -> 359px, anchor gap 12 -> 9,
// rows 29 -> 22 tall, text 24 -> 18, icons ~28 -> ~21.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/components/providers/AuthProvider";

export function ProfileMenu({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth();
  const router = useRouter();

  if (!user) return null;

  return (
    <div className="absolute right-0 top-[calc(100%+9px)] z-50 w-[359px] max-w-[calc(100vw-48px)] overflow-clip rounded-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.18)]">
      <Link
        href={ROUTES.account}
        onClick={onClose}
        className="mt-[32px] flex h-[22px] items-center gap-[11px] pl-[30px]"
      >
        <img
          src="/figma/icon-view-profile.svg"
          alt=""
          className="h-[21px] w-[22px] shrink-0"
        />
        <span className="text-[18px] leading-normal text-black">
          View My Profile
        </span>
      </Link>
      <div className="mx-[14px] mt-[22px] h-px bg-[#cfcfcf]" />
      <button
        type="button"
        onClick={() => {
          // Navigate as soon as the Firebase session drops.
          void signOut().then(() => router.push(ROUTES.home));
          onClose();
        }}
        className="mb-[32px] mt-[21px] flex h-[22px] cursor-pointer items-center gap-[12px] pl-[32px]"
      >
        <img
          src="/figma/icon-log-out.svg"
          alt=""
          className="size-[19px] shrink-0"
        />
        <span className="text-[18px] leading-normal text-[#c00]">Log Out</span>
      </button>
    </div>
  );
}
