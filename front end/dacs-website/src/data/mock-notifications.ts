import type { AppNotification } from "@/types/notification";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Notification content matches the Figma Notification dropdown (203:60):
// two unread items (highlighted) followed by two read items. The dates are
// offsets from "now" so the relative timestamps render exactly as in the
// frame ("2 hours ago", "1 day ago", "1 day ago", "3 days ago").
export const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: "notif-1",
    type: "order",
    title: "Order Shipped",
    message: "Your order #ORD-2026-001 has been shipped.",
    date: new Date(Date.now() - 2 * HOUR).toISOString(),
    read: false,
  },
  {
    id: "notif-2",
    type: "seminar",
    title: "New Seminar Schedule",
    message: "New seminar schedule for Module 2 is now available.",
    date: new Date(Date.now() - 1 * DAY).toISOString(),
    read: false,
  },
  {
    id: "notif-3",
    type: "seminar",
    title: "Booking Confirmed",
    message: "Your consultancy booking for June 30 is confirmed.",
    date: new Date(Date.now() - 1 * DAY - 2 * HOUR).toISOString(),
    read: true,
    href: "/booking-confirmed",
  },
  {
    id: "notif-4",
    type: "order",
    title: "Form Received",
    message: "PS Order Form submission received. Processing in progress.",
    date: new Date(Date.now() - 3 * DAY).toISOString(),
    read: true,
  },
];
