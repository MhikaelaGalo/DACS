import { Router, type NextFunction, type Request, type Response } from "express";

import { prisma } from "../config/database";
import { firebaseAuth } from "../config/firebase";

const healthRouter = Router();

healthRouter.get("/", (request: Request, response: Response): void => {
  response.json({
    success: true,
    message: "DACS backend is running.",
  });
});

healthRouter.get(
  "/database",
  async (
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await prisma.$queryRaw`SELECT 1`;

      let databaseName = "unknown";
      try {
        databaseName = new URL(process.env.DATABASE_URL ?? "").pathname.replace(
          "/",
          ""
        );
      } catch {
        // keep "unknown" if DATABASE_URL cannot be parsed
      }

      response.json({
        success: true,
        message: "Database connection is working.",
        database: databaseName,
      });
    } catch (error) {
      next(error);
    }
  }
);

healthRouter.get("/firebase", (request: Request, response: Response): void => {
  if (!firebaseAuth) {
    response.status(503).json({
      success: false,
      message:
        "Firebase Admin is not configured. Place the service-account JSON at " +
        "the path set in GOOGLE_APPLICATION_CREDENTIALS and restart the server.",
    });
    return;
  }

  response.json({
    success: true,
    message: "Firebase Admin connection is working.",
  });
});

export { healthRouter };
