/*
 * Backend activity/audit log (read-only by design — the API has no
 * update or delete routes and never should). Owner-only. Mirrors
 * back end/src/modules/audit.
 */
import { ROLE_LABELS, type StaffRole } from "../auth";
import { api } from "../api";
import type { AuditLogRow } from "@/types/admin";

interface ApiAuditLog {
  id: string;
  userId: string | null;
  module: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE";
  description: string;
  recordType: string | null;
  recordId: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    role: string;
    displayName: string | null;
  } | null;
}

export async function listAuditLogs(options?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const response = await api.get<{
    data: ApiAuditLog[];
    pagination: { total: number; page: number; pageSize: number };
  }>("/api/audit-logs", {
    page: options?.page,
    pageSize: options?.pageSize,
    search: options?.search,
  });
  return {
    rows: response.data.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      userEmail: entry.user?.email ?? "System",
      roleLabel: entry.user
        ? (ROLE_LABELS[entry.user.role as StaffRole] ??
          (entry.user.role === "CLIENT_FARMER" ? "Farmer" : entry.user.role))
        : "System",
      module: entry.module,
      action: entry.action,
      description: entry.description,
    })),
    total: response.pagination.total,
  };
}
