import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredUuid,
} from "../../utils/validation";
import {
  deleteHistoricalFile,
  getHistoricalFile,
  getHistoricalRecord,
  getImportErrors,
  importHistoricalWorkbook,
  listHistoricalFiles,
  listHistoricalRecords,
  reimportHistoricalFile,
  resolveImportError,
  reviewHistoricalRecord,
} from "./historical.service";

const RECORD_TYPES = [
  "BREEDER_CERTIFICATE",
  "SEMINAR",
  "PARENT_STOCK",
  "ORDER",
] as const;
const VALIDATION_STATUSES = [
  "VALID",
  "PARTIAL",
  "NEEDS_REVIEW",
  "INVALID",
] as const;

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function queryEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T | undefined {
  const raw = queryString(value);
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new HttpError(400, `${label} is not valid.`);
  }
  return raw as T;
}

// XLSX files are ZIP archives: they always start with "PK\x03\x04".
function isXlsxBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
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

function requestMeta(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

export async function uploadHistoricalFile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: "A spreadsheet file is required.",
      });
      return;
    }

    if (!isXlsxBuffer(file.buffer)) {
      throw new HttpError(400, "Only Excel (.xlsx) files can be imported.");
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["category", "year", "description"]);

    let year: number | null = null;
    if (raw.year !== undefined && raw.year !== null && raw.year !== "") {
      year = Number(raw.year);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        throw new HttpError(400, "Year must be a valid four-digit year.");
      }
    }

    const result = await importHistoricalWorkbook(
      actor.id,
      file.buffer,
      file.originalname,
      {
        category: optionalString(raw.category, "Category", 100),
        year,
        description: optionalString(raw.description, "Description", 500),
      },
      requestMeta(request)
    );

    response.status(201).json({
      success: true,
      message: "Historical file was uploaded and imported.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function listFiles(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    let year: number | undefined;
    if (typeof request.query.year === "string" && request.query.year !== "") {
      year = Number(request.query.year);
      if (!Number.isInteger(year)) {
        throw new HttpError(400, "The year filter is not valid.");
      }
    }

    const files = await listHistoricalFiles({
      search:
        typeof request.query.search === "string"
          ? request.query.search
          : undefined,
      category:
        typeof request.query.category === "string"
          ? request.query.category
          : undefined,
      year,
    });

    response.json({
      success: true,
      count: files.length,
      data: files,
    });
  } catch (error) {
    next(error);
  }
}

export async function getFile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const fileId = requiredUuid(request.params.fileId, "The file ID");
    const file = await getHistoricalFile(fileId);

    response.json({
      success: true,
      data: file,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeFile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const fileId = requiredUuid(request.params.fileId, "The file ID");
    const file = await deleteHistoricalFile(actor.id, fileId, requestMeta(request));

    response.json({
      success: true,
      message: "Historical file was deleted. Imported customers are retained.",
      data: file,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * GET /api/historical/records — server-side pagination, filtering and
 * search over the lossless historical layer (the admin never loads all
 * 1,500+ rows at once).
 */
export async function listRecords(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = request.query;

    let page = 1;
    if (queryString(query.page) !== undefined) {
      page = Number(query.page);
      if (!Number.isInteger(page) || page < 1) {
        throw new HttpError(400, "page must be a positive whole number.");
      }
    }

    let pageSize = 20;
    if (queryString(query.pageSize) !== undefined) {
      pageSize = Number(query.pageSize);
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        throw new HttpError(400, "pageSize must be between 1 and 100.");
      }
    }

    let linked: boolean | undefined;
    if (queryString(query.linked) !== undefined) {
      if (query.linked !== "true" && query.linked !== "false") {
        throw new HttpError(400, "linked must be true or false.");
      }
      linked = query.linked === "true";
    }

    const result = await listHistoricalRecords({
      recordType: queryEnum(query.recordType, RECORD_TYPES, "recordType"),
      validationStatus: queryEnum(
        query.validationStatus,
        VALIDATION_STATUSES,
        "validationStatus"
      ),
      historicalFileId:
        queryString(query.historicalFileId) !== undefined
          ? requiredUuid(query.historicalFileId, "The file ID")
          : undefined,
      importId:
        queryString(query.importId) !== undefined
          ? requiredUuid(query.importId, "The import ID")
          : undefined,
      customerProfileId:
        queryString(query.customerProfileId) !== undefined
          ? requiredUuid(query.customerProfileId, "The customer profile ID")
          : undefined,
      farmId:
        queryString(query.farmId) !== undefined
          ? requiredUuid(query.farmId, "The farm ID")
          : undefined,
      sheetName: queryString(query.sheetName),
      search: queryString(query.search),
      linked,
      page,
      pageSize,
    });

    response.json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getRecord(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const recordId = requiredUuid(request.params.recordId, "The record ID");
    const record = await getHistoricalRecord(recordId);

    response.json({
      success: true,
      data: record,
    });
  } catch (error) {
    next(error);
  }
}

export async function reviewRecord(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const recordId = requiredUuid(request.params.recordId, "The record ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["notes"]);

    const reviewed = await reviewHistoricalRecord(
      actor.id,
      recordId,
      optionalString(raw.notes, "Notes", 500) ?? null,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Historical record was marked as reviewed.",
      data: reviewed,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * POST /api/historical/files/:fileId/reimport — re-runs the import from
 * the file's stored copy so workbooks imported before the lossless
 * layer existed can be backfilled. Idempotent by design.
 */
export async function reimportFile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const fileId = requiredUuid(request.params.fileId, "The file ID");
    const result = await reimportHistoricalFile(
      actor.id,
      fileId,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Historical file was re-imported from its stored copy.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function listErrors(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const importId = requiredUuid(request.params.importId, "The import ID");

    let resolved: boolean | undefined;
    if (request.query.resolved !== undefined) {
      if (request.query.resolved !== "true" && request.query.resolved !== "false") {
        throw new HttpError(400, "resolved must be true or false.");
      }
      resolved = request.query.resolved === "true";
    }

    const errors = await getImportErrors(importId, resolved);

    response.json({
      success: true,
      count: errors.length,
      data: errors,
    });
  } catch (error) {
    next(error);
  }
}

export async function resolveError(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const errorId = requiredUuid(request.params.errorId, "The error ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["notes"]);

    const resolved = await resolveImportError(
      actor.id,
      errorId,
      optionalString(raw.notes, "Notes", 500) ?? null,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Import error was marked as resolved.",
      data: resolved,
    });
  } catch (error) {
    next(error);
  }
}
