import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  createVisualForUser,
  deleteVisualForUser,
  getVisualsForUser,
  reorderVisualsForUser,
  updateVisualForUser,
  VISUAL_TYPES,
  type CreateVisualInput,
  type UpdateVisualInput,
  type VisualType,
} from "./dashboard.service";

const VISUAL_FIELDS = [
  "visualType",
  "title",
  "dataset",
  "xField",
  "xBucket",
  "yField",
  "aggregation",
  "legendField",
  "builtin",
] as const;

/* builtin identifies a shipped chart and is fixed after creation. */
const VISUAL_UPDATE_FIELDS = [
  "visualType",
  "title",
  "dataset",
  "xField",
  "xBucket",
  "yField",
  "aggregation",
  "legendField",
] as const;

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

function requireVisualType(value: unknown): VisualType {
  if (
    typeof value !== "string" ||
    !VISUAL_TYPES.includes(value as VisualType)
  ) {
    throw new HttpError(400, "The visual type is not valid.", "visualType");
  }
  return value as VisualType;
}

export async function listVisuals(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const visuals = await getVisualsForUser(actor.id);

    response.json({
      success: true,
      count: visuals.length,
      data: visuals,
    });
  } catch (error) {
    next(error);
  }
}

export async function createVisual(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, VISUAL_FIELDS);

    const input: CreateVisualInput = {
      visualType: requireVisualType(raw.visualType),
      title: requiredString(raw.title, "Visual title", 150),
      dataset: optionalString(raw.dataset, "Data source", 100),
      xField: optionalString(raw.xField, "X-axis field", 100),
      xBucket: optionalString(raw.xBucket, "Date grouping", 20),
      yField: optionalString(raw.yField, "Y-axis field", 100),
      aggregation: optionalString(raw.aggregation, "Aggregation", 20),
      legendField: optionalString(raw.legendField, "Legend field", 100),
      builtin: optionalString(raw.builtin, "Builtin identifier", 50),
    };

    const visual = await createVisualForUser(actor.id, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.status(201).json({
      success: true,
      message: "Dashboard visual was created successfully.",
      data: visual,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateVisual(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const visualId = requiredUuid(request.params.visualId, "The visual ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, VISUAL_UPDATE_FIELDS);

    const input: UpdateVisualInput = {};

    if (raw.visualType !== undefined) {
      input.visualType = requireVisualType(raw.visualType);
    }

    if (raw.title !== undefined) {
      input.title = requiredString(raw.title, "Visual title", 150);
    }

    if (raw.dataset !== undefined) {
      input.dataset = optionalString(raw.dataset, "Data source", 100);
    }

    if (raw.xField !== undefined) {
      input.xField = optionalString(raw.xField, "X-axis field", 100);
    }

    if (raw.xBucket !== undefined) {
      input.xBucket = optionalString(raw.xBucket, "Date grouping", 20);
    }

    if (raw.yField !== undefined) {
      input.yField = optionalString(raw.yField, "Y-axis field", 100);
    }

    if (raw.aggregation !== undefined) {
      input.aggregation = optionalString(raw.aggregation, "Aggregation", 20);
    }

    if (raw.legendField !== undefined) {
      input.legendField = optionalString(raw.legendField, "Legend field", 100);
    }

    const visual = await updateVisualForUser(actor.id, visualId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Dashboard visual was updated successfully.",
      data: visual,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteVisual(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const visualId = requiredUuid(request.params.visualId, "The visual ID");

    const visual = await deleteVisualForUser(actor.id, visualId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: `Dashboard visual "${visual.title}" was deleted.`,
      data: visual,
    });
  } catch (error) {
    next(error);
  }
}

export async function reorderVisuals(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["orderedVisualIds"]);

    if (
      !Array.isArray(raw.orderedVisualIds) ||
      raw.orderedVisualIds.length === 0
    ) {
      throw new HttpError(
        400,
        "orderedVisualIds must be a list of visual IDs.",
        "orderedVisualIds"
      );
    }

    const orderedVisualIds = raw.orderedVisualIds.map((value) =>
      requiredUuid(value, "Every entry in orderedVisualIds")
    );

    const visuals = await reorderVisualsForUser(actor.id, orderedVisualIds, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Dashboard visuals were reordered successfully.",
      count: visuals.length,
      data: visuals,
    });
  } catch (error) {
    next(error);
  }
}
