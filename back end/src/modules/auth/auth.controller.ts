import type { NextFunction, Request, Response } from "express";

import { syncFirebaseUser } from "./auth.service";

export function testAuth(request: Request, response: Response): void {
  response.json({
    success: true,
    message: "Firebase token is valid.",
    firebaseUid: request.firebaseUser?.uid,
  });
}

export async function syncCurrentUser(
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

    const { user, created } = await syncFirebaseUser(firebaseUser, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "DACS account was created successfully."
        : "DACS account was synchronized successfully.",
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

export function getCurrentDacsUser(request: Request, response: Response): void {
  const dacsUser = request.dacsUser;

  if (!dacsUser) {
    response.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
    return;
  }

  response.json({
    success: true,
    message: "Current DACS account retrieved successfully.",
    data: {
      id: dacsUser.id,
      email: dacsUser.email,
      emailVerified: request.firebaseUser?.email_verified ?? false,
      role: dacsUser.role,
      status: dacsUser.status,
      lastLoginAt: dacsUser.lastLoginAt,
      createdAt: dacsUser.createdAt,
    },
  });
}
