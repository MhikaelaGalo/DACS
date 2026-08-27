import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { uploadLimiter } from "../../middleware/rateLimit";
import { uploadSingleSpreadsheet } from "../../middleware/uploadImage";
import {
  getFile,
  getRecord,
  listErrors,
  listFiles,
  listRecords,
  reimportFile,
  removeFile,
  resolveError,
  reviewRecord,
  uploadHistoricalFile,
} from "./historical.controller";

const historicalRouter = Router();

historicalRouter.use(authenticateFirebase);
historicalRouter.use(loadDacsUser);

/*
 * Historical records are an internal archive: everything is staff-only
 * (Owner + Administrative Staff). Downloads use the storageUrl served
 * by the /uploads static route.
 */
historicalRouter.use(authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"));

historicalRouter.post(
  "/files",
  uploadLimiter,
  uploadSingleSpreadsheet("file"),
  uploadHistoricalFile
);

historicalRouter.get("/files", listFiles);

historicalRouter.get("/files/:fileId", getFile);

// Re-import (backfill) is as heavy as an upload, so it shares the
// upload throttle.
historicalRouter.post("/files/:fileId/reimport", uploadLimiter, reimportFile);

historicalRouter.delete("/files/:fileId", removeFile);

/*
 * Lossless historical source records: server-paginated listing with
 * search/filters, full record detail, and the review workflow.
 */
historicalRouter.get("/records", listRecords);

historicalRouter.get("/records/:recordId", getRecord);

historicalRouter.patch("/records/:recordId/review", reviewRecord);

historicalRouter.get("/imports/:importId/errors", listErrors);

historicalRouter.patch("/errors/:errorId/resolve", resolveError);

export { historicalRouter };
