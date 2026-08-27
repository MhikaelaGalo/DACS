import type { NextFunction, Request, Response } from "express";

/*
 * authenticateFirebase answers: is this really a Firebase user?
 * requireVerifiedEmail answers:  has that user verified their email?
 *
 * Applied to operational write actions; basic account reads stay
 * available to unverified users.
 */
export function requireVerifiedEmail(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const firebaseUser = request.firebaseUser;

  if (!firebaseUser) {
    response.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
    return;
  }

  if (firebaseUser.email_verified !== true) {
    response.status(403).json({
      success: false,
      message: "Please verify your email address before using this feature.",
    });
    return;
  }

  next();
}
