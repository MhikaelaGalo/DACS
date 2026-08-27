import type { NextFunction, Request, Response } from "express";

import type { OrderType } from "../../../generated/prisma/client";

import { HttpError } from "../../utils/httpError";
import { optionalString, requiredString } from "../../utils/validation";
import {
  getFieldCatalog,
  runAnalyticsQuery,
} from "./analytics.catalog";
import {
  buildExportCsv,
  EXPORT_REPORTS,
  getBreederAnalytics,
  getCustomerAnalytics,
  getDashboardSummary,
  getInquiryAnalytics,
  getOrderAnalytics,
  getPaymentAnalytics,
  getSeminarAnalytics,
  type DateRange,
  type ExportReport,
} from "./analytics.service";

const VALID_ORDER_TYPES = [
  "PARENT_STOCK",
  "F1",
  "VETERINARY_PRODUCT",
  "SEMINAR",
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/*
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD. "from" starts at midnight UTC, "to"
 * runs to the end of its day so a single-day range covers the full day.
 */
function parseDateRange(query: Request["query"]): DateRange {
  const range: DateRange = {};

  for (const field of ["from", "to"] as const) {
    const value = query[field];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
      throw new HttpError(400, `${field} must use YYYY-MM-DD format.`, field);
    }

    const suffix = field === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    const date = new Date(`${value}${suffix}`);

    if (Number.isNaN(date.getTime())) {
      throw new HttpError(400, `${field} is not a valid date.`, field);
    }

    range[field] = date;
  }

  if (range.from && range.to && range.to.getTime() < range.from.getTime()) {
    throw new HttpError(400, "to cannot be earlier than from.", "to");
  }

  return range;
}

function parseOrderType(query: Request["query"]): OrderType | undefined {
  const value = query.orderType;

  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !VALID_ORDER_TYPES.includes(value as OrderType)
  ) {
    throw new HttpError(400, "The orderType filter is not valid.", "orderType");
  }

  return value as OrderType;
}

export async function dashboard(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const summary = await getDashboardSummary(parseDateRange(request.query));
    response.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

export async function customerAnalytics(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getCustomerAnalytics(parseDateRange(request.query));
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function orderAnalytics(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getOrderAnalytics(
      parseDateRange(request.query),
      parseOrderType(request.query)
    );
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function paymentAnalytics(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getPaymentAnalytics(parseDateRange(request.query));
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function seminarAnalytics(
  _request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getSeminarAnalytics();
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function breederAnalytics(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getBreederAnalytics({
      region: optionalString(request.query.region, "Region", 100) ?? undefined,
      province:
        optionalString(request.query.province, "Province", 100) ?? undefined,
    });
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function inquiryAnalytics(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getInquiryAnalytics(
      parseDateRange(request.query),
      optionalString(request.query.category, "Category", 100) ?? undefined
    );
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/*
 * GET /fields — the Create Visual field catalog: datasets with their
 * dimensions, measures and allowed aggregations. Metadata only; the
 * SQL behind each field never leaves the backend.
 */
export function fields(
  _request: Request,
  response: Response,
  next: NextFunction
): void {
  try {
    response.json({ success: true, data: getFieldCatalog() });
  } catch (error) {
    next(error);
  }
}

/*
 * GET /query?dataset=orders&xField=orderType&yField=count — one
 * aggregated series for a custom visual. Every parameter is a catalog
 * ID validated against the allowlist; aggregation happens in
 * PostgreSQL and only the grouped rows travel to the browser.
 */
export async function query(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await runAnalyticsQuery({
      dataset: requiredString(request.query.dataset, "Data source", 100),
      xField: optionalString(request.query.xField, "X-axis field", 100),
      xBucket: optionalString(request.query.xBucket, "Date grouping", 20),
      yField: requiredString(request.query.yField, "Value field", 100),
      aggregation: optionalString(request.query.aggregation, "Aggregation", 20),
      legendField: optionalString(request.query.legendField, "Legend field", 100),
    });
    response.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

/*
 * GET /export?report=orders&from=...&to=... streams a CSV download the
 * frontend can hand straight to the browser.
 */
export async function exportReport(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const report = request.query.report;

    if (
      typeof report !== "string" ||
      !EXPORT_REPORTS.includes(report as ExportReport)
    ) {
      response.status(400).json({
        success: false,
        message: `The report parameter must be one of: ${EXPORT_REPORTS.join(", ")}.`,
      });
      return;
    }

    const csv = await buildExportCsv(
      report as ExportReport,
      parseDateRange(request.query)
    );

    const stamp = new Date().toISOString().slice(0, 10);

    response
      .status(200)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="dacs-${report}-${stamp}.csv"`
      )
      .send(csv);
  } catch (error) {
    next(error);
  }
}
