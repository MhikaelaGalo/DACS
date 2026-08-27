import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";

/*
 * Read API over the existing activity_logs table (the single audit
 * system every module writes to through recordActivity). Strictly
 * read-only: audit records are never updated or deleted through the
 * API.
 */

export interface AuditLogFilters {
  userId?: string;
  module?: string;
  action?: string;
  outcome?: "SUCCESS" | "FAILURE";
  /* Inclusive day range; `to` covers the whole day. */
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function searchActivityLogs(filters: AuditLogFilters) {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);

  const where: Prisma.ActivityLogWhereInput = {
    userId: filters.userId,
    outcome: filters.outcome,
    ...(filters.module
      ? { module: { equals: filters.module, mode: "insensitive" } }
      : {}),
    ...(filters.action
      ? { action: { equals: filters.action, mode: "insensitive" } }
      : {}),
  };

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to
        ? { lte: new Date(filters.to.getTime() + 24 * 60 * 60 * 1000 - 1) }
        : {}),
    };
  }

  if (filters.search) {
    where.OR = [
      { action: { contains: filters.search, mode: "insensitive" } },
      { module: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
      { recordId: { equals: filters.search } },
      { user: { email: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const [records, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            displayName: true,
          },
        },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    records,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
