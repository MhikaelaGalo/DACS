import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import { requiredUuid } from "../../utils/validation";
import { searchActivityLogs, type AuditLogFilters } from "./audit.service";

const OUTCOMES = ["SUCCESS", "FAILURE"] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function queryParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function queryDate(value: unknown, field: string): Date | undefined {
  const raw = queryParam(value);
  if (raw === undefined) return undefined;

  if (!DATE_PATTERN.test(raw)) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD format.`, field);
  }

  const date = new Date(`${raw}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is not a valid date.`, field);
  }

  return date;
}

function queryPositiveInteger(value: unknown, field: string): number | undefined {
  const raw = queryParam(value);
  if (raw === undefined) return undefined;

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive whole number.`, field);
  }

  return parsed;
}

export async function listAuditLogs(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const filters: AuditLogFilters = {
      module: queryParam(request.query.module),
      action: queryParam(request.query.action),
      search: queryParam(request.query.search),
      from: queryDate(request.query.from, "from"),
      to: queryDate(request.query.to, "to"),
      page: queryPositiveInteger(request.query.page, "page"),
      pageSize: queryPositiveInteger(request.query.pageSize, "pageSize"),
    };

    const userId = queryParam(request.query.userId);
    if (userId !== undefined) {
      filters.userId = requiredUuid(userId, "The user ID filter");
    }

    const outcome = queryParam(request.query.outcome);
    if (outcome !== undefined) {
      if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
        throw new HttpError(400, "The outcome filter is not valid.", "outcome");
      }
      filters.outcome = outcome as (typeof OUTCOMES)[number];
    }

    const result = await searchActivityLogs(filters);

    response.json({
      success: true,
      count: result.records.length,
      pagination: result.pagination,
      data: result.records,
    });
  } catch (error) {
    next(error);
  }
}
