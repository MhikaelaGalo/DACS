import type { NextFunction, Request, Response } from "express";

import type {
  AccountStatus,
  UserRole,
} from "../../../generated/prisma/client";

import { HttpError } from "../../utils/httpError";
import {
  optionalPhoneNumber,
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  changeUserRole,
  changeUserStatus,
  createPreAuthorizedUser,
  getAllUsers,
  getUserById,
} from "./user.service";

const VALID_ROLES = [
  "OWNER_EXECUTIVE",
  "IT_STAFF",
  "ADMINISTRATIVE_STAFF",
  "CLIENT_FARMER",
] as const;

const VALID_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;

export async function listUsers(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const users = await getAllUsers();

    response.json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    next(error);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = request.dacsUser;

    if (!actor) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, [
      "firstName",
      "lastName",
      "email",
      "phoneNumber",
      "role",
    ]);

    const email = requiredString(raw.email, "Email", 254).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      throw new HttpError(400, "Email is not a valid email address.");
    }

    if (typeof raw.role !== "string" || !VALID_ROLES.includes(raw.role as UserRole)) {
      throw new HttpError(400, "Role must be a valid DACS role.");
    }

    const firstName = optionalString(raw.firstName, "First name", 100);
    const lastName = optionalString(raw.lastName, "Last name", 100);
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ").trim() || null;

    const user = await createPreAuthorizedUser(
      actor.id,
      {
        email,
        role: raw.role as UserRole,
        displayName,
        phoneNumber: optionalPhoneNumber(raw.phoneNumber, "Phone number") ?? null,
      },
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.status(201).json({
      success: true,
      message:
        "User was added. They can now sign in with their Google account.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}

export async function getIndividualUser(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = requiredUuid(request.params.userId, "The user ID");
    const user = await getUserById(userId);

    response.json({
      success: true,
      message: "User retrieved successfully.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUserRole(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = request.dacsUser;

    if (!actor) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const targetUserId = requiredUuid(request.params.userId, "The user ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["role"]);

    if (typeof raw.role !== "string") {
      response.status(400).json({
        success: false,
        message: "A valid role is required.",
      });
      return;
    }

    if (!VALID_ROLES.includes(raw.role as UserRole)) {
      response.status(400).json({
        success: false,
        message: "The requested role is not valid.",
      });
      return;
    }

    const user = await changeUserRole(
      actor.id,
      targetUserId,
      raw.role as UserRole,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "User role was updated successfully.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateUserStatus(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = request.dacsUser;

    if (!actor) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const targetUserId = requiredUuid(request.params.userId, "The user ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["status"]);

    if (typeof raw.status !== "string") {
      response.status(400).json({
        success: false,
        message: "A valid account status is required.",
      });
      return;
    }

    if (!VALID_STATUSES.includes(raw.status as AccountStatus)) {
      response.status(400).json({
        success: false,
        message: "The requested account status is not valid.",
      });
      return;
    }

    const user = await changeUserStatus(
      { id: actor.id, role: actor.role },
      targetUserId,
      raw.status as AccountStatus,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Account status was updated successfully.",
      data: user,
    });
  } catch (error) {
    next(error);
  }
}
