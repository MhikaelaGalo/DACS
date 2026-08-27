import "dotenv/config";

import type { NextFunction, Request, Response } from "express";

import { prisma } from "../config/database";

/*
 * Staff sessions have an absolute lifetime. The check runs against the
 * token's auth_time — the moment the person actually signed in with
 * Google — which survives the Firebase SDK's silent hourly token
 * refreshes, so it cannot be extended without a real re-login. Client
 * farmers keep the consumer default of staying signed in indefinitely.
 */
const STAFF_SESSION_MAX_AGE_HOURS =
  Number(process.env.SESSION_MAX_AGE_HOURS) || 12;

export async function loadDacsUser(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const firebaseUser = request.firebaseUser;

    if (!firebaseUser) {
      response.status(401).json({
        success: false,
        message: "Authentication token is required.",
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { firebaseUid: firebaseUser.uid },
    });

    if (!user) {
      response.status(403).json({
        success: false,
        message:
          "No DACS account is linked to this Firebase user. " +
          "Call POST /api/auth/sync first.",
      });
      return;
    }

    if (user.status === "SUSPENDED") {
      response.status(403).json({
        success: false,
        message: "This DACS account is suspended.",
      });
      return;
    }

    if (user.status === "DISABLED") {
      response.status(403).json({
        success: false,
        message: "This DACS account is disabled.",
      });
      return;
    }

    if (user.role !== "CLIENT_FARMER") {
      const sessionAgeSeconds =
        Math.floor(Date.now() / 1000) - firebaseUser.auth_time;
      if (sessionAgeSeconds > STAFF_SESSION_MAX_AGE_HOURS * 3600) {
        response.status(401).json({
          success: false,
          message: "Your session has expired. Please sign in again.",
        });
        return;
      }
    }

    request.dacsUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
