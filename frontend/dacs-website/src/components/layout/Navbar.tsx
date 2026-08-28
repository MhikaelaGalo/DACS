"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { AvatarImage } from "@/components/profile/AvatarImage";
import { SignInRequiredDialog } from "@/components/auth/SignInRequiredDialog";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCart } from "@/components/providers/CartProvider";
import { CartPanel } from "@/components/cart/CartPanel";
import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import { ProfileMenu } from "@/components/profile/ProfileMenu";
import {
  fetchUnreadCount,
  NOTIFICATIONS_CHANGED_EVENT,
} from "@/services/notification.service";

const NAV_LINKS = [
  { label: "Home", href: ROUTES.home },
  { label: "Products", href: ROUTES.products },
  { label: "Seminar", href: ROUTES.seminars },
  { label: "Forms", href: ROUTES.forms },
];

// Figma header (1920 frame, rendered at 0.75 scale in a 1440px container):
// 112px tall -> 84px, logo 60x85 -> 45x64, nav 20px/91 gap -> 15px/68,
// cart 36x29 -> 27x22, bell 30x33 -> 23x25, avatar 64 -> 48.
// Routes whose Figma frames show the signed-out header state (red "Sign In"
// text) regardless of the mock session — the authentication-page variant.
const AUTH_ROUTES = [ROUTES.register, ROUTES.signIn, ROUTES.forgotPassword];

export function Navbar() {
  const { user: sessionUser } = useAuth();
  // Total units in the signed-in account's cart (sum of quantities, not
  // rows) — CartProvider rehydrates it per account, so the badge follows
  // the session with no stale count after switching or signing out.
  const { count: cartItemCount } = useCart();
  const pathname = usePathname();
  const isAuthPage = AUTH_ROUTES.some((r) => pathname.startsWith(r));
  const user = isAuthPage ? null : sessionUser;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Non-null while the "Sign In Required" dialog is open (holds its message).
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  // Unread notifications for the SIGNED-IN account only; 0 while signed out
  // or before the client-side storage read, so a previous account's count
  // never carries over or flashes.
  const [unreadCount, setUnreadCount] = useState(0);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setCartOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
    setSignInMessage(null);
  }, [pathname]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetchUnreadCount()
        .then((count) => {
          if (!cancelled) setUnreadCount(count);
        })
        .catch(() => {
          /* Badge keeps its last value when the backend is unreachable. */
        });
    };
    refresh();
    // Mark-read actions in this tab announce themselves; a window focus
    // re-check picks up notifications created while the tab was away.
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [user, pathname]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rightRef.current && !rightRef.current.contains(e.target as Node)) {
        setCartOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <header className="relative z-50 w-full bg-white">
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-[20px] pb-[10px] pt-[10px] lg:px-[42px]">
        <div className="flex min-w-0 flex-1 items-center gap-[20px] lg:gap-[50px]">
          <Link href={ROUTES.home} className="block h-[64px] w-[45px] shrink-0">
            <Image
              src="/images/logo.png"
              alt="Dominant Asia Poultry Genetics"
              width={45}
              height={64}
              className="size-full object-cover"
              priority
            />
          </Link>
          <nav className="hidden items-center gap-[68px] text-[15px] text-black lg:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className="whitespace-nowrap text-center leading-normal"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div
          ref={rightRef}
          className="relative flex shrink-0 items-center justify-between gap-[18px] lg:w-[167px] lg:gap-0"
        >
          <button
            type="button"
            aria-label={`Cart with ${cartItemCount} item${
              cartItemCount === 1 ? "" : "s"
            }`}
            onClick={() => {
              if (!user) {
                setSignInMessage(
                  "You must sign in to your DACS account before ordering a product."
                );
                setNotifOpen(false);
                return;
              }
              setCartOpen((v) => !v);
              setNotifOpen(false);
              setProfileOpen(false);
            }}
            className="relative block h-[22px] w-[27px] shrink-0 cursor-pointer"
          >
            <img src="/figma/icon-cart.svg" alt="" className="size-full" />
            {user && cartItemCount > 0 && (
              <span className="absolute -right-[7px] -top-[6px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#c00] px-[3px] text-[9px] font-bold leading-none text-white">
                {cartItemCount > 99 ? "99+" : cartItemCount}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => {
              if (!user) {
                setSignInMessage(
                  "You must sign in to view your notifications."
                );
                setCartOpen(false);
                return;
              }
              setNotifOpen((v) => !v);
              setCartOpen(false);
              setProfileOpen(false);
            }}
            className="relative block h-[25px] w-[23px] shrink-0 cursor-pointer"
          >
            <img src="/figma/icon-bell.svg" alt="" className="size-full" />
            {user && unreadCount > 0 && (
              <span
                aria-label={`${unreadCount} unread notifications`}
                className="absolute -right-[6px] -top-[5px] flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[#c00] px-[3px] text-[9px] font-bold leading-none text-white"
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {user ? (
            <button
              type="button"
              aria-label="Profile"
              onClick={() => {
                setProfileOpen((v) => !v);
                setCartOpen(false);
                setNotifOpen(false);
              }}
              className="block size-[48px] shrink-0 cursor-pointer overflow-hidden rounded-full"
            >
              <AvatarImage src={user.avatarUrl} alt={user.fullName} size={48} />
            </button>
          ) : (
            <Link
              href={ROUTES.signIn}
              className="w-[49px] text-center text-[15px] leading-normal text-[#c00]"
            >
              Sign In
            </Link>
          )}
          <button
            type="button"
            aria-label="Menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="block shrink-0 cursor-pointer lg:hidden"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          {cartOpen && <CartPanel onClose={() => setCartOpen(false)} />}
          {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
          {profileOpen && <ProfileMenu onClose={() => setProfileOpen(false)} />}
        </div>
      </div>
      <SignInRequiredDialog
        open={signInMessage !== null}
        onClose={() => setSignInMessage(null)}
        returnTo={pathname}
        message={signInMessage ?? undefined}
      />
      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-[#e5e5e5] bg-white px-[20px] py-3 text-[16px] text-black lg:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="py-2"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
