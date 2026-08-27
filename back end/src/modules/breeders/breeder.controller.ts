import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredUuid,
} from "../../utils/validation";
import {
  evaluateBreederEligibility,
  getBreederRecord,
  getMyBreederStatus,
  issueBreederCertification,
  listBreederRecords,
  updateBreederMonitoring,
  type UpdateMonitoringInput,
} from "./breeder.service";

const MONITORING_FIELDS = [
  "breederDate",
  "numberAlive",
  "vaccinationRecords",
  "feedingManagement",
  "healthManagement",
  "weightManagement",
  "breedersClaimed",
] as const;

const BREEDER_STATUSES = ["ACTIVE", "PENDING", "EXPIRED", "INELIGIBLE"] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD format.`, field);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is not a valid date.`, field);
  }

  return date;
}

function requireActor(request: Request, response: Response) {
  const actor = request.dacsUser;

  if (!actor) {
    response.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
    return null;
  }

  return actor;
}

export async function getMyBreederStatusHandler(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const result = await getMyBreederStatus(actor.id);

    response.json({
      success: true,
      customerNumber: result.customerNumber,
      count: result.breeders.length,
      data: result.breeders,
    });
  } catch (error) {
    next(error);
  }
}

export async function listBreeders(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    let status: (typeof BREEDER_STATUSES)[number] | undefined;

    if (request.query.status !== undefined) {
      if (
        typeof request.query.status !== "string" ||
        !BREEDER_STATUSES.includes(
          request.query.status as (typeof BREEDER_STATUSES)[number]
        )
      ) {
        throw new HttpError(400, "The breeder-status filter is not valid.");
      }
      status = request.query.status as (typeof BREEDER_STATUSES)[number];
    }

    const region =
      typeof request.query.region === "string" ? request.query.region : undefined;
    const province =
      typeof request.query.province === "string"
        ? request.query.province
        : undefined;

    const records = await listBreederRecords({ status, region, province });

    response.json({
      success: true,
      count: records.length,
      filters: {
        status: status ?? null,
        region: region ?? null,
        province: province ?? null,
      },
      data: records,
    });
  } catch (error) {
    next(error);
  }
}

export async function getBreeder(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const monitoringId = requiredUuid(
      request.params.monitoringId,
      "The monitoring ID"
    );

    const record = await getBreederRecord(monitoringId);

    response.json({
      success: true,
      data: record,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMonitoring(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const monitoringId = requiredUuid(
      request.params.monitoringId,
      "The monitoring ID"
    );

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, MONITORING_FIELDS);

    const input: UpdateMonitoringInput = {
      breederDate: optionalDate(raw.breederDate, "breederDate"),
      // Free text ("D853 - 30f + 6m"), matching the paper records.
      numberAlive: optionalString(raw.numberAlive, "Number alive", 200),
      vaccinationRecords: optionalString(
        raw.vaccinationRecords,
        "Vaccination records",
        1000
      ),
      feedingManagement: optionalString(
        raw.feedingManagement,
        "Feeding management",
        1000
      ),
      healthManagement: optionalString(
        raw.healthManagement,
        "Health management",
        1000
      ),
      weightManagement: optionalString(
        raw.weightManagement,
        "Weight management",
        1000
      ),
      breedersClaimed: optionalString(raw.breedersClaimed, "Breeders claimed", 200),
    };

    const monitoring = await updateBreederMonitoring(
      actor.id,
      monitoringId,
      input,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message: "Breeder monitoring information was updated.",
      data: monitoring,
    });
  } catch (error) {
    next(error);
  }
}

export async function evaluateEligibility(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const monitoringId = requiredUuid(
      request.params.monitoringId,
      "The monitoring ID"
    );

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["decision", "remarks"]);

    if (raw.decision !== "ELIGIBLE" && raw.decision !== "INELIGIBLE") {
      throw new HttpError(400, "decision must be ELIGIBLE or INELIGIBLE.");
    }

    const eligibility = await evaluateBreederEligibility(
      actor.id,
      monitoringId,
      raw.decision,
      optionalString(raw.remarks, "Remarks", 500) ?? null,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message: `Breeder eligibility was marked ${raw.decision.toLowerCase()}.`,
      data: eligibility,
    });
  } catch (error) {
    next(error);
  }
}

export async function issueCertification(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const monitoringId = requiredUuid(
      request.params.monitoringId,
      "The monitoring ID"
    );

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["remarks"]);

    const certification = await issueBreederCertification(
      actor.id,
      monitoringId,
      optionalString(raw.remarks, "Remarks", 500) ?? null,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.status(201).json({
      success: true,
      message: "Breeder certification was issued successfully.",
      data: certification,
    });
  } catch (error) {
    next(error);
  }
}
