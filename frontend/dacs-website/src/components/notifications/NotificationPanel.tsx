"use client";

// Figma: Notification dropdown (203:60) — opens from the navbar bell.
// Unread notifications render on a light-red band with semibold text;
// read notifications render on white with regular text.
// Rendered at 0.75 scale: 478px wide -> 359px, anchor gap 12 -> 9,
// message text 24 -> 18, meta 16 -> 12, unread dot 20 -> 15.
// The list is the signed-in account's only (user-scoped storage), newest
// first; clicking a notification marks it read and follows its href when
// one is attached.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as notificationService from "@/services/notification.service";
import type { AppNotification } from "@/types/notification";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    notificationService
      .fetchNotifications()
      .then((list) => {
        if (cancelled) return;
        setNotifications(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnread = notifications.some((n) => !n.read);

  function open(notification: AppNotification) {
    if (!notification.read) {
      // Optimistic: flip locally, tell the backend, roll back on failure.
      setNotifications((current) =>
        current.map((n) =>
          n.id === notification.id ? { ...n, read: true } : n
        )
      );
      notificationService.markRead(notification.id).catch(() => {
        setNotifications((current) =>
          current.map((n) =>
            n.id === notification.id ? { ...n, read: false } : n
          )
        );
      });
    }
    if (notification.href) {
      onClose();
      router.push(notification.href);
    }
  }

  function onMarkAllRead() {
    const before = notifications;
    setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    notificationService.markAllRead().catch(() => setNotifications(before));
  }

  return (
    <div className="absolute right-0 top-[calc(100%+9px)] z-50 w-[359px] max-w-[calc(100vw-48px)] overflow-clip rounded-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.18)]">
      <div className="flex items-baseline justify-between pl-[32px] pr-[26px] pt-[32px]">
        <p className="text-[18px] font-bold leading-normal text-black">
          Notifications
        </p>
        {hasUnread && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="cursor-pointer text-[12px] font-light leading-normal text-[#c00]"
          >
            Mark all as read
          </button>
        )}
      </div>
      <div className="mt-[9px] max-h-[460px] overflow-y-auto pb-[22px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && (
          <div className="px-[32px] py-[15px]">
            <p className="text-[12px] font-light leading-normal text-[#7d7d7d]">
              Loading notifications...
            </p>
          </div>
        )}
        {!loading && loadError && (
          <div className="px-[32px] py-[15px]">
            <p className="text-[12px] font-light leading-normal text-[#c00]">
              Notifications could not be loaded. Please try again later.
            </p>
          </div>
        )}
        {!loading && !loadError && notifications.length === 0 && (
          <div className="px-[32px] py-[15px]">
            <p className="text-[12px] font-light leading-normal text-[#7d7d7d]">
              No notifications yet.
            </p>
            <p className="mt-[5px] text-[12px] font-light leading-normal text-[#7d7d7d]">
              Updates about your orders, seminars, tickets, and account
              activity will appear here.
            </p>
          </div>
        )}
        {notifications.map((n, i) => (
          <button
            key={n.id}
            type="button"
            onClick={() => open(n)}
            className={`flex w-full cursor-pointer items-center gap-[19px] pb-[11px] pl-[25px] pr-[26px] pt-[10px] text-left ${
              n.read ? "" : "bg-[rgba(204,0,0,0.15)]"
            } ${i > 0 && n.read && !notifications[i - 1].read ? "mt-[11px]" : ""}`}
          >
            <span className="size-[15px] shrink-0 rounded-full bg-[#c00]" />
            <div className="min-w-0 flex-1">
              <p
                className={`text-[18px] leading-normal text-black ${
                  n.read ? "font-normal" : "font-semibold"
                }`}
              >
                {n.message}
              </p>
              <p className="mt-[5px] text-[12px] font-light leading-normal text-black">
                {timeAgo(n.date)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
