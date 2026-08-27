export const ORDER_STATUSES = [
  "Pending",
  "Confirmed",
  "Processing",
  "To Ship",
  "Shipped",
  "To Receive",
  "Received",
  "Delivered",
  "Completed",
  "Cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SEMINAR_STATUSES = ["Not Started", "In Progress", "Completed"] as const;

export type SeminarStatus = (typeof SEMINAR_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "order",
  "order-status",
  "seminar",
  "module",
  "ticket",
  "booking",
  "certificate",
  "account",
  "system",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
