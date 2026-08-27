import type { NextFunction, Request, Response } from "express";

import type { UserRole } from "../../generated/prisma/client";

export function authorizeRoles(...allowedRoles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    if (!allowedRoles.includes(dacsUser.role)) {
      response.status(403).json({
        success: false,
        message: "You do not have permission to access this resource.",
      });
      return;
    }

    next();
  };
}
