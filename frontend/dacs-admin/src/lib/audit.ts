/*
 * Client-side audit trail for the mock build: admin actions append here
 * and Settings > Audit Logs shows them above the seeded rows.
 * Integration swap: the backend's activity log already records these —
 * this file then becomes a no-op and the tab reads GET /api/activity.
 */
import { getSession, ROLE_LABELS } from "./auth";
import { readStorage, STORAGE_KEYS, writeStorage } from "./storage";
import type { AuditLogRow } from "@/types/admin";

export function appendAudit(
  module: string,
  action: string,
  description: string
): void {
  const session = getSession();
  const entry: AuditLogRow = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    userEmail: session?.email ?? "unknown",
    roleLabel: session ? ROLE_LABELS[session.role] : "Unknown",
    module,
    action,
    description,
  };
  const existing = readStorage<AuditLogRow[]>(STORAGE_KEYS.auditLog, []);
  writeStorage(STORAGE_KEYS.auditLog, [entry, ...existing].slice(0, 200));
}

export function getLocalAudit(): AuditLogRow[] {
  return readStorage<AuditLogRow[]>(STORAGE_KEYS.auditLog, []);
}
