import type { NextFunction, Request, Response } from "express";

import { firebaseAuth } from "../config/firebase";

export async function authenticateFirebase(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  const authorizationHeader = request.headers.authorization;

  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    response.status(401).json({
      success: false,
      message: "Authentication token is required.",
    });
    return;
  }

  if (!firebaseAuth) {
    response.status(503).json({
      success: false,
      message:
        "Firebase Admin is not configured on this server. " +
        "Add the service-account credentials and restart.",
    });
    return;
  }

  const idToken = authorizationHeader.slice("Bearer ".length).trim();

  try {
    request.firebaseUser = await firebaseAuth.verifyIdToken(idToken);
    next();
  } catch {
    response.status(401).json({
      success: false,
      message: "Authentication token is invalid or expired.",
    });
  }
}
