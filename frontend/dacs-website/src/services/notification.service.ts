/*
 * Notifications come from the DACS backend (/api/notifications) — the
 * server creates them inside its own flows (e.g. an approved seminar
 * certificate); the site only lists and marks them read.
 */
import { api, ApiError } from "@/lib/api";
import type { AppNotification } from "@/types/notification";
import type { NotificationType } from "@/constants/statuses";

/**
 * Fired on window whenever this tab changes notification state, so the
 * navbar unread badge refetches without polling.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "dacs:notifications-changed";

function emitChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/* GET /api/notifications -> data[n] */
interface ApiNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

const TYPE_MAP: Record<string, NotificationType> = {
  CERTIFICATE_APPROVED: "certificate",
  CERTIFICATE_EXPIRED: "certificate",
  NEW_ORDER: "order",
  NEW_TICKET: "ticket",
  NEW_CUSTOMER: "account",
};

function toAppNotification(row: ApiNotification): AppNotification {
  return {
    id: row.id,
    type: TYPE_MAP[row.type] ?? "system",
    title: row.title,
    message: row.message,
    date: row.createdAt,
    read: row.readAt !== null,
  };
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const response = await api.get<{ data: ApiNotification[] }>(
    "/api/notifications",
    { pageSize: 50 }
  );
  return response.data.map(toAppNotification);
}

export async function fetchUnreadCount(): Promise<number> {
  const response = await api.get<{ count: number }>(
    "/api/notifications/unread-count"
  );
  return response.count;
}

export async function markRead(id: string): Promise<void> {
  try {
    await api.patch(`/api/notifications/${id}/read`);
  } catch (error) {
    // Already read (double-click) — the desired state holds.
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
  }
  emitChanged();
}

export async function markAllRead(): Promise<void> {
  await api.patch("/api/notifications/read-all");
  emitChanged();
}

/**
 * @deprecated The backend creates notifications inside its own flows —
 * the site must never fabricate them. This no-op only keeps not-yet-
 * integrated mock flows compiling; each integration wave deletes its
 * call sites.
 */
export function addNotification(
  _notification: Omit<AppNotification, "id" | "date" | "read">
): void {
  void _notification;
}
