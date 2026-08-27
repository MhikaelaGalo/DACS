import type { NextFunction, Request, Response } from "express";

import type { NotificationType } from "../../../generated/prisma/client";

import { HttpError } from "../../utils/httpError";
import { rejectUnexpectedFields, requiredUuid } from "../../utils/validation";
import {
  getNotificationPreferencesForUser,
  getNotificationsForUser,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  NOTIFICATION_TYPES,
  updateNotificationPreferencesForUser,
  type PreferenceUpdateInput,
} from "./notification.service";

function requireUser(request: Request, response: Response) {
  const user = request.dacsUser;

  if (!user) {
    response.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
    return null;
  }

  return user;
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  field: string
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HttpError(400, `${field} must be a positive whole number.`, field);
  }

  return parsed;
}

export async function listMyNotifications(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const unreadOnly = request.query.unreadOnly === "true";
    const page = parsePositiveInt(request.query.page, 1, "page");
    const pageSize = parsePositiveInt(request.query.pageSize, 20, "pageSize");

    const result = await getNotificationsForUser(user.id, {
      unreadOnly,
      page,
      pageSize,
    });

    response.json({
      success: true,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      data: result.notifications,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyUnreadCount(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const count = await getUnreadNotificationCount(user.id);

    response.json({ success: true, count });
  } catch (error) {
    next(error);
  }
}

export async function readNotification(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const notificationId = requiredUuid(
      request.params.notificationId,
      "The notification ID"
    );

    const notification = await markNotificationAsRead(user.id, notificationId);

    response.json({
      success: true,
      message: "Notification was marked as read.",
      data: notification,
    });
  } catch (error) {
    next(error);
  }
}

export async function readAllNotifications(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const result = await markAllNotificationsAsRead(user.id);

    response.json({
      success: true,
      message: `${result.markedRead} notification(s) were marked as read.`,
      markedRead: result.markedRead,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyPreferences(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const preferences = await getNotificationPreferencesForUser(user.id);

    response.json({ success: true, data: preferences });
  } catch (error) {
    next(error);
  }
}

/*
 * Body: { preferences: [{ type, enabled }, ...] } — partial updates are
 * fine; unmentioned types keep their current setting.
 */
export async function updateMyPreferences(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = requireUser(request, response);
    if (!user) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["preferences"]);

    if (!Array.isArray(raw.preferences) || raw.preferences.length === 0) {
      response.status(400).json({
        success: false,
        message: "At least one notification preference is required.",
      });
      return;
    }

    const updates: PreferenceUpdateInput[] = [];
    const seenTypes = new Set<string>();

    for (const rawPreference of raw.preferences) {
      if (
        typeof rawPreference !== "object" ||
        rawPreference === null ||
        Array.isArray(rawPreference)
      ) {
        response.status(400).json({
          success: false,
          message: "Every preference must be a valid object.",
        });
        return;
      }

      const preference = rawPreference as Record<string, unknown>;

      const unexpectedField = Object.keys(preference).find(
        (field) => field !== "type" && field !== "enabled"
      );

      if (unexpectedField) {
        response.status(400).json({
          success: false,
          message: `The preference field "${unexpectedField}" is not allowed.`,
        });
        return;
      }

      if (
        typeof preference.type !== "string" ||
        !NOTIFICATION_TYPES.includes(preference.type as NotificationType)
      ) {
        response.status(400).json({
          success: false,
          message: "One or more notification types are not valid.",
        });
        return;
      }

      if (typeof preference.enabled !== "boolean") {
        response.status(400).json({
          success: false,
          message: "Every preference needs enabled set to true or false.",
        });
        return;
      }

      if (seenTypes.has(preference.type)) {
        response.status(400).json({
          success: false,
          message: "Each notification type may appear only once.",
        });
        return;
      }

      seenTypes.add(preference.type);
      updates.push({
        type: preference.type as NotificationType,
        enabled: preference.enabled,
      });
    }

    const preferences = await updateNotificationPreferencesForUser(
      user.id,
      updates,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Notification preferences were saved.",
      data: preferences,
    });
  } catch (error) {
    next(error);
  }
}
