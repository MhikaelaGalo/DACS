"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, X } from "lucide-react";

import type { NotificationRow } from "@/types/admin";

/*
 * Compact notifications bell. It sits beside the sidebar collapse
 * chevron on desktop (the "edge" variant matches that floating circle)
 * and next to the hamburger in the mobile top bar (the "bar" variant
 * matches that button). Clicking it opens the Figma notifications panel
 * ("Notifications" heading, X close, "Nothing new to show" when empty);
 * opening marks the items read. The item state is lifted to the Sidebar
 * so the desktop and mobile bells always show the same unread badge.
 * Integration swap: list from GET /api/notifications, badge from
 * GET /api/notifications/unread-count, PATCH /read-all on open.
 */
export function NotificationsBell({
  variant = "edge",
  className = "",
  items,
  onItemsChange,
}: {
  /* "edge" = circular chip like the collapse button; "bar" = top-bar button. */
  variant?: "edge" | "bar";
  className?: string;
  items: NotificationRow[];
  onItemsChange: (next: NotificationRow[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    left: number;
    top: number;
    width: number;
  }>({ left: 0, top: 0, width: 380 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unread = items.filter((item) => !item.readAt).length;

  function togglePanel() {
    if (open) {
      setOpen(false);
      return;
    }
    /*
     * The panel uses fixed positioning: to the right of the bell when
     * there is room, otherwise below it clamped to the viewport (the
     * usual case for a bell at the sidebar's right edge or in the
     * mobile top bar).
     */
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      /* clientWidth excludes the scrollbar, unlike 100vw/innerWidth. */
      const viewportWidth = document.documentElement.clientWidth;
      const panelWidth = Math.min(380, viewportWidth - 24);
      let left = rect.right + 12;
      let top = rect.top;
      if (left + panelWidth > viewportWidth - 12) {
        left = Math.min(
          Math.max(12, rect.left),
          Math.max(12, viewportWidth - panelWidth - 12)
        );
        top = rect.bottom + 8;
      }
      top = Math.max(12, Math.min(top, Math.max(12, window.innerHeight - 440)));
      setPanelPos({ left, top, width: panelWidth });
    }
    if (unread > 0) {
      const now = new Date().toISOString();
      onItemsChange(
        items.map((item) => ({ ...item, readAt: item.readAt ?? now }))
      );
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Notifications"
        aria-label={`Notifications (${unread} unread)`}
        aria-expanded={open}
        onClick={togglePanel}
        className={`${
          /*
           * No position class here on purpose: the "edge" callers pass
           * `absolute ...` (which also anchors the badge), while "bar"
           * stays in flow and brings its own `relative` for the badge.
           */
          variant === "edge"
            ? `rounded-full border border-dacs-light bg-white p-1.5 shadow-dacs-card ${
                open
                  ? "text-dacs-dark"
                  : "text-dacs-muted hover:text-dacs-dark"
              }`
            : `relative rounded-xl p-2 text-dacs-dark hover:bg-dacs-light ${
                open ? "bg-dacs-light" : ""
              }`
        } ${className}`}
      >
        <Bell size={variant === "edge" ? 16 : 24} strokeWidth={2} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dacs-red px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {/*
       * The panel is portaled to <body>: the sticky sidebar and the
       * sticky mobile top bar each create a stacking context, so a
       * fixed panel rendered inside them would paint underneath later
       * page content no matter its z-index.
       */}
      {open &&
        createPortal(
          <>
          {/* Click-away catcher: keeps the panel above drawer/backdrop. */}
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default"
          />
          <div
            style={{ left: panelPos.left, top: panelPos.top, width: panelPos.width }}
            className="fixed z-[61] rounded-2xl border border-dacs-light bg-white p-4 shadow-dacs-card"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold">Notifications</p>
              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => setOpen(false)}
                className="text-dacs-dark hover:text-dacs-red"
              >
                <X size={18} />
              </button>
            </div>

            {items.length === 0 ? (
              <p className="pb-24 pt-2 text-sm text-dacs-muted">
                Nothing new to show
              </p>
            ) : (
              <ul className="flex max-h-[min(360px,calc(100vh-8rem))] flex-col gap-2 overflow-y-auto">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-dacs-light p-3"
                  >
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-sm text-dacs-muted">{item.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>,
          document.body
        )}
    </>
  );
}
