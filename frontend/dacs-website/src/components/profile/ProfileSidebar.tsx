"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/constants/routes";

// Figma: shared account sidebar ("User Profile Page" / "My Profile" + menu),
// present on frames 203:55, 255:3998, 255:4285, 255:4190, 255:4095, 255:4380.
const MENU_ITEMS = [
  {
    label: "Personal Info",
    href: ROUTES.account,
    icon: "/figma/icon-menu-personal-info.svg",
    activeIcon: "/figma/icon-menu-personal-info-red.svg",
  },
  {
    label: "Farm Details",
    href: ROUTES.accountFarm,
    icon: "/figma/icon-menu-farm-details.svg",
    activeIcon: "/figma/icon-menu-farm-details-red.svg",
  },
  {
    label: "Modules Taken",
    href: ROUTES.accountModules,
    icon: "/figma/icon-menu-modules-taken.svg",
    activeIcon: "/figma/icon-menu-modules-taken-red.svg",
  },
  {
    label: "Order History",
    href: ROUTES.accountOrders,
    icon: "/figma/icon-menu-order-history.svg",
    activeIcon: "/figma/icon-menu-order-history-red.svg",
  },
  {
    label: "Security",
    href: ROUTES.accountSecurity,
    icon: "/figma/icon-menu-security.svg",
    activeIcon: "/figma/icon-menu-security-red.svg",
  },
];

export function ProfileSidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === ROUTES.account) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className={className}>
      <p className="text-[18px] font-semibold leading-normal text-[#c00]">
        User Profile Page
      </p>
      <p className="mt-[7px] text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
        My Profile
      </p>
      <nav className="mt-[40px] flex flex-col gap-[27px] lg:mt-[52px]">
        {MENU_ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="relative flex h-[25px] items-center gap-[8px] pl-[8px]"
            >
              <span className="flex w-[18px] shrink-0 items-center justify-center">
                <img
                  src={active ? item.activeIcon : item.icon}
                  alt=""
                  className="max-h-[20px] max-w-[18px]"
                />
              </span>
              <span
                className={`whitespace-nowrap text-[18px] leading-normal ${
                  active ? "font-bold text-[#c00]" : "text-black"
                }`}
              >
                {item.label}
              </span>
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-[33px] h-px w-full bg-[#c00]"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
