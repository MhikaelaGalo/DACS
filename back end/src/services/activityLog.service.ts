import type { Prisma } from "../../generated/prisma/client";

/*
 * Central activity-log writer for all DACS modules.
 *
 * Every state-changing action (customer, farm, auth, and later orders,
 * payments, seminars...) records its audit entry through this one
 * function, so the log format stays consistent everywhere.
 *
 * Pass the surrounding transaction so the action and its log entry
 * succeed or fail together; the top-level prisma client also satisfies
 * the same type for non-transactional callers.
 */
export interface ActivityLogEntry {
  userId?: string | null;
  module: string;
  action: string;
  outcome?: "SUCCESS" | "FAILURE";
  description?: string;
  recordType?: string;
  recordId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

export async function recordActivity(
  client: Prisma.TransactionClient,
  entry: ActivityLogEntry
): Promise<void> {
  await client.activityLog.create({
    data: {
      userId: entry.userId ?? null,
      module: entry.module,
      action: entry.action,
      outcome: entry.outcome ?? "SUCCESS",
      description: entry.description,
      recordType: entry.recordType,
      recordId: entry.recordId,
      metadata: entry.metadata,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  });
}
