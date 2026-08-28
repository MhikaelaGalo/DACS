import type { NotificationType } from "@/constants/statuses";

/**
 * One notification belonging to a single account: records are stored under
 * the user-scoped "dacs.notifications.<userId>" key, so the owner is the key,
 * not a field on the record.
 */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  date: string;
  read: boolean;
  /** Optional page the notification opens when clicked. */
  href?: string;
  /**
   * Id of the order/module/ticket the notification describes — used to skip
   * creating a duplicate for the same event (e.g. re-submitting a passed
   * exam).
   */
  relatedId?: string;
}
