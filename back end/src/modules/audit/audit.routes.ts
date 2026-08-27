import { Router } from "express";

import { AUDIT_LOG_ACCESS } from "../../config/permissions";
import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { listAuditLogs } from "./audit.controller";

const auditRouter = Router();

/*
 * Read-only by design: activity records are written exclusively through
 * recordActivity inside each module's transactions. There are no
 * update or delete routes, and there never should be.
 */
auditRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...AUDIT_LOG_ACCESS.viewLogs),
  listAuditLogs
);

export { auditRouter };
