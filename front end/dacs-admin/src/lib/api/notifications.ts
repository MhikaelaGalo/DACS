/*
 * Per-user notifications + preferences. Mirrors
 * back end/src/modules/notifications (every staff role has its own
 * feed; farmers get theirs on the customer site).
 */
import { api } from "../api";
import type { NotificationRow } from "@/types/admin";

export type NotificationTypeEnum =
  | "NEW_CUSTOMER"
  | "NEW_ORDER"
  | "NEW_TICKET"
  | "CERTIFICATE_APPROVED"
  | "CERTIFICATE_EXPIRED"
  | "ORDER_AUTO_CANCELLED";

export const NOTIFICATION_TYPE_LABELS: Record<NotificationTypeEnum, string> = {
  NEW_CUSTOMER: "New Customer Registration",
  NEW_ORDER: "New Order",
  NEW_TICKET: "New Inquiry Ticket",
  CERTIFICATE_APPROVED: "Certification Approved",
  CERTIFICATE_EXPIRED: "Certification Expiring",
  ORDER_AUTO_CANCELLED: "Order Auto-Cancelled (No Payment)",
};

export const NOTIFICATION_ENUM_BY_LABEL: Record<string, NotificationTypeEnum> =
  Object.fromEntries(
    Object.entries(NOTIFICATION_TYPE_LABELS).map(([type, label]) => [
      label,
      type as NotificationTypeEnum,
    ])
  );

interface ApiNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(pageSize = 20): Promise<NotificationRow[]> {
  const response = await api.get<{ data: ApiNotification[] }>(
    "/api/notifications",
    { pageSize }
  );
  return response.data.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    readAt: row.readAt,
    createdAt: row.createdAt,
  }));
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.patch("/api/notifications/read-all");
}

export async function getNotificationPreferences(): Promise<
  Array<{ type: NotificationTypeEnum; enabled: boolean }>
> {
  const response = await api.get<{
    data: Array<{ type: NotificationTypeEnum; enabled: boolean }>;
  }>("/api/notifications/preferences");
  return response.data;
}

export async function updateNotificationPreferences(
  preferences: Array<{ type: NotificationTypeEnum; enabled: boolean }>
): Promise<void> {
  await api.patch("/api/notifications/preferences", { preferences });
}
