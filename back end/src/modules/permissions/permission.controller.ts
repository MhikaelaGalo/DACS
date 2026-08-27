import type { NextFunction, Request, Response } from "express";

import {
  MATRIX_ROLES,
  PERMISSION_MODULES,
  type MatrixRole,
  type PermissionModule,
} from "../../config/permissions";
import { HttpError } from "../../utils/httpError";
import { rejectUnexpectedFields } from "../../utils/validation";
import {
  getPermissionMatrix,
  updatePermissionMatrix,
  type PermissionUpdate,
} from "./permission.service";

const UPDATE_ENTRY_FIELDS = ["role", "permissionModule", "allowed"] as const;

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

export async function getMatrix(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const matrix = await getPermissionMatrix();

    response.json({
      success: true,
      data: matrix,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMatrix(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["updates"]);

    if (!Array.isArray(raw.updates) || raw.updates.length === 0) {
      throw new HttpError(
        400,
        "updates must be a list of role/module permission changes.",
        "updates"
      );
    }

    const updates: PermissionUpdate[] = [];

    for (const rawUpdate of raw.updates) {
      if (
        typeof rawUpdate !== "object" ||
        rawUpdate === null ||
        Array.isArray(rawUpdate)
      ) {
        throw new HttpError(400, "Every update must be a valid object.", "updates");
      }

      const update = rawUpdate as Record<string, unknown>;
      rejectUnexpectedFields(update, UPDATE_ENTRY_FIELDS);

      if (
        typeof update.role !== "string" ||
        !MATRIX_ROLES.includes(update.role as MatrixRole)
      ) {
        throw new HttpError(400, "One or more roles are not valid.", "role");
      }

      if (
        typeof update.permissionModule !== "string" ||
        !PERMISSION_MODULES.includes(
          update.permissionModule as PermissionModule
        )
      ) {
        throw new HttpError(
          400,
          "One or more permission modules are not valid.",
          "permissionModule"
        );
      }

      if (typeof update.allowed !== "boolean") {
        throw new HttpError(400, "allowed must be true or false.", "allowed");
      }

      updates.push({
        role: update.role as MatrixRole,
        permissionModule: update.permissionModule as PermissionModule,
        allowed: update.allowed,
      });
    }

    const matrix = await updatePermissionMatrix(
      { id: actor.id, role: actor.role },
      updates,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message: "Role permissions were updated successfully.",
      data: matrix,
    });
  } catch (error) {
    next(error);
  }
}
