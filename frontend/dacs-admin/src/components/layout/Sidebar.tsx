"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderOpen,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  PlaySquare,
  Settings,
  Users,
  X,
} from "lucide-react";

import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { signOut } from "@/lib/auth";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import { usePersistentState } from "@/lib/stores";
import {
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/api/notifications";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type { NotificationRow } from "@/types/admin";

const CUSTOMER_SUBLINKS = [
  { href: "/customers/order-tracking", label: "Order Tracking" },
  { href: "/customers/seminar-progress", label: "Seminar Progress" },
  { href: "/customers/breeder-monitoring", label: "Breeder Monitoring" },
  { href: "/customers/ticket-monitoring", label: "Ticket Monitoring" },
];

const MAIN_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customer Information", icon: Users },
  { href: "/seminar", label: "Seminar", icon: PlaySquare },
  { href: "/forms", label: "Forms", icon: FileText },
  { href: "/historical", label: "Historical Data", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

/*
 * Navigation list shared by the desktop sidebar and the mobile drawer.
 * "Customer Information" is a collapsible group: the label navigates to
 * the Order Confirmation Queue (its Figma landing page), the chevron
 * toggles the submenu, and the group auto-expands while the user is on
 * any /customers route. Notifications is NOT a nav item — the bell sits
 * beside the collapse chevron (desktop) / hamburger (mobile top bar).
 */
function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const onCustomerPages = pathname.startsWith("/customers");
  const [customerOpen, setCustomerOpen] = useState(onCustomerPages);

  /* Navigating into a Customer Information page keeps the group open. */
  useEffect(() => {
    if (onCustomerPages) setCustomerOpen(true);
  }, [onCustomerPages]);

  return (
    <nav className="flex flex-col gap-2">
      {MAIN_LINKS.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href !== "/dashboard" && pathname.startsWith(`${href}/`));
        const isCustomerGroup = href === "/customers";

        return (
          <div key={href}>
            <div
              className={`flex items-center rounded-2xl transition-colors ${
                active
                  ? "bg-dacs-light text-dacs-dark"
                  : "text-dacs-dark hover:bg-dacs-light/60"
              }`}
            >
              <Link
                href={href}
                title={collapsed ? label : undefined}
                onClick={() => {
                  if (isCustomerGroup) setCustomerOpen(true);
                  onNavigate?.();
                }}
                className={`flex min-w-0 flex-1 items-center gap-4 py-3 text-[15px] font-medium ${
                  collapsed ? "justify-center px-0" : "px-4"
                }`}
              >
                <Icon size={22} strokeWidth={2} className="shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>

              {isCustomerGroup && !collapsed && (
                <button
                  type="button"
                  aria-label={
                    customerOpen
                      ? "Collapse Customer Information menu"
                      : "Expand Customer Information menu"
                  }
                  aria-expanded={customerOpen}
                  onClick={() => setCustomerOpen(!customerOpen)}
                  className="mr-2 rounded-lg p-1.5 text-dacs-muted hover:bg-dacs-light hover:text-dacs-dark"
                >
                  {customerOpen ? (
                    <ChevronDown size={17} />
                  ) : (
                    <ChevronRight size={17} />
                  )}
                </button>
              )}
            </div>

            {/* Collapsible submenu (smooth grid-rows height animation). */}
            {isCustomerGroup && !collapsed && (
              <div
                className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
                  customerOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="mt-1 flex flex-col gap-1 pl-9">
                    {CUSTOMER_SUBLINKS.map((sub) => (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        onClick={onNavigate}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                          pathname === sub.href
                            ? "bg-dacs-light font-medium text-dacs-dark"
                            : "text-dacs-muted hover:bg-dacs-light/60"
                        }`}
                      >
                        <List size={16} className="shrink-0" />
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function LogOutLink({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/sign-in"
      onClick={() => {
        signOut();
        onNavigate?.();
      }}
      title={collapsed ? "Log Out" : undefined}
      className={`flex items-center gap-3 text-[15px] font-medium text-dacs-red hover:opacity-80 ${
        collapsed ? "justify-center" : "px-4"
      }`}
    >
      <LogOut size={20} className="shrink-0" />
      {!collapsed && "Log Out"}
    </Link>
  );
}

/*
 * Responsive navigation: on desktop (lg+) the sidebar is sticky and
 * exactly viewport height, so it stays visible while the page content
 * scrolls; the nav area scrolls internally if it ever outgrows the
 * viewport and Log Out stays pinned at the bottom (flex column, not
 * absolute positioning). It collapses to an icon rail. Below lg it
 * becomes a top bar with a hamburger that opens a slide-in drawer; the
 * drawer closes after choosing a page.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = usePersistentState<boolean>(
    `${STORAGE_KEYS.preferences}.sidebar-collapsed`,
    false
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  /*
   * Notification state is shared by the desktop sidebar and the mobile
   * drawer (both are in the DOM), so reading them in one place keeps
   * the two badges in sync. Items come from the signed-in user's feed
   * (GET /api/notifications); opening the panel marks everything read
   * locally, which is mirrored server-side via PATCH /read-all.
   */
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.notifications);
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const rows = await listNotifications();
      setNotifications((current) => {
        /*
         * Keep locally-read items read: opening the panel marks items
         * read optimistically while PATCH /read-all is still in flight,
         * and a poll response from before that commit must not
         * resurrect the unread badge.
         */
        const readLocally = new Map(
          current
            .filter((item) => item.readAt)
            .map((item) => [item.id, item.readAt])
        );
        return rows.map((row) =>
          row.readAt ? row : { ...row, readAt: readLocally.get(row.id) ?? null }
        );
      });
    } catch {
      /* Bell keeps the last known items when the feed can't load. */
    }
  }, []);

  /* The sidebar never remounts on navigation, so the feed polls — this
     is how staff learn about new orders/tickets without a reload. */
  useAutoRefresh(loadNotifications, 5_000);

  function handleNotificationsChange(next: NotificationRow[]) {
    const hadUnread = notifications.some((item) => !item.readAt);
    setNotifications(next);
    if (hadUnread && next.every((item) => item.readAt)) {
      void markAllNotificationsRead().catch(() => {
        /* Badge already cleared locally; the server catches up next load. */
      });
    }
  }

  /* Safety net: close the drawer on any route change. */
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ---------- Mobile top bar (below lg) ---------- */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-dacs-light bg-white px-4 py-3 lg:hidden">
        <Image
          src="/dominant-asia-logo.png"
          alt="Dominant Asia Poultry Genetics"
          width={44}
          height={44}
        />
        <div className="flex items-center gap-1.5">
          <NotificationsBell
            variant="bar"
            items={notifications}
            onItemsChange={handleNotificationsChange}
          />
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-xl p-2 text-dacs-dark hover:bg-dacs-light"
          >
            <Menu size={26} />
          </button>
        </div>
      </header>

      {/* ---------- Mobile drawer ---------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[290px] max-w-[85vw] animate-[drawer-in_0.2s_ease-out] flex-col justify-between overflow-y-auto bg-white px-5 py-6 shadow-2xl">
            <div>
              <div className="mb-8 flex items-center justify-between">
                <Image
                  src="/dominant-asia-logo.png"
                  alt="Dominant Asia Poultry Genetics"
                  width={56}
                  height={56}
                />
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-xl p-2 text-dacs-dark hover:bg-dacs-light"
                >
                  <X size={22} />
                </button>
              </div>
              <SidebarNav onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="mt-8">
              <LogOutLink onNavigate={() => setDrawerOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      {/* ---------- Desktop sidebar (lg+): sticky, viewport height ---------- */}
      <aside
        className={`relative hidden shrink-0 flex-col border-r border-dacs-light bg-white transition-all lg:sticky lg:top-0 lg:flex lg:h-screen ${
          collapsed ? "w-[84px]" : "w-[290px]"
        }`}
      >
        {/*
         * Top-right control cluster: the bell sits beside the collapse
         * chevron when expanded; on the collapsed rail it drops below
         * the chevron so it never overlaps the centered logo.
         */}
        <NotificationsBell
          items={notifications}
          onItemsChange={handleNotificationsChange}
          className={`absolute z-10 ${
            collapsed ? "-right-3.5 top-[76px]" : "right-6 top-9"
          }`}
        />
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3.5 top-9 z-10 rounded-full border border-dacs-light bg-white p-1.5 text-dacs-muted shadow-dacs-card hover:text-dacs-dark"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>

        {/* Scrollable nav area; Log Out below stays pinned to the bottom. */}
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto pt-8 ${
            collapsed ? "px-3" : "px-5"
          }`}
        >
          <Image
            src="/dominant-asia-logo.png"
            alt="Dominant Asia Poultry Genetics"
            width={collapsed ? 48 : 72}
            height={collapsed ? 48 : 72}
            className={`mb-10 shrink-0 ${collapsed ? "mx-auto" : "ml-2"}`}
          />
          <SidebarNav collapsed={collapsed} />
        </div>

        <div className={`shrink-0 py-6 ${collapsed ? "px-3" : "px-5"}`}>
          <LogOutLink collapsed={collapsed} />
        </div>
      </aside>
    </>
  );
}
