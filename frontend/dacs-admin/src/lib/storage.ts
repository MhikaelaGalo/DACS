/*
 * SSR-safe localStorage JSON helpers (same pattern as dacs-website).
 * Mock persistence only — every read/write here is replaced by API
 * calls during backend integration.
 */
export const STORAGE_KEYS = {
  session: "dacs-admin.session",
  /* Last user interaction, shared across admin tabs (idle timeout). */
  lastActivity: "dacs-admin.last-activity",
  formDraft: "dacs-admin.form-draft",
  deletedForms: "dacs-admin.deleted-forms",
  visuals: "dacs-admin.dashboard-visuals",
  preferences: "dacs-admin.system-preferences",
  orders: "dacs-admin.orders",
  modules: "dacs-admin.seminar-modules",
  moduleContent: "dacs-admin.seminar-content",
  users: "dacs-admin.staff-users",
  permissions: "dacs-admin.role-permissions",
  historical: "dacs-admin.historical-files",
  generalInfo: "dacs-admin.general-info",
  notifPrefs: "dacs-admin.notification-preferences",
  auditLog: "dacs-admin.audit-log",
  notifications: "dacs-admin.notifications",
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / storage unavailable — mock data simply won't persist.
  }
}

export function removeStorage(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}
