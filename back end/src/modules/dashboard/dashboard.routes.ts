import { Router, type RequestHandler } from "express";

import { prisma } from "../../config/database";
import { defaultPermissionGrants } from "../../config/permissions";
import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { fields, query } from "../analytics/analytics.controller";
import {
  createVisual,
  deleteVisual,
  savedVisualData,
  sharedSummary,
  listVisuals,
  reorderVisuals,
  updateVisual,
} from "./dashboard.controller";

const dashboardRouter = Router();

dashboardRouter.use(
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF", "IT_STAFF")
);

dashboardRouter.get("/visuals", listVisuals);
dashboardRouter.get("/visuals/:visualId/data", savedVisualData);
dashboardRouter.get("/summary", sharedSummary);

// A disabled Dashboard grant leaves the layout readable. All layout writes
// require the current grant for the account authenticated by the server.
const requireDashboardEdit: RequestHandler = async (request, response, next) => {
  const role = request.dacsUser?.role;
  if (!role || role === "CLIENT_FARMER") {
    response.sendStatus(403);
    return;
  }
  const override = await prisma.rolePermission.findUnique({
    where: { role_permissionModule: { role, permissionModule: "Dashboard" } },
    select: { allowed: true },
  });
  if (!(override?.allowed ?? defaultPermissionGrants().Dashboard[role])) {
    response.status(403).json({ success: false, message: "Your dashboard is view-only." });
    return;
  }
  next();
};

dashboardRouter.use(requireDashboardEdit);
dashboardRouter.get("/fields", fields);
dashboardRouter.get("/preview", query);
// Older admin clients may request initialization when the shared board is empty.
dashboardRouter.post("/visuals/initialize", listVisuals);
dashboardRouter.post("/visuals", createVisual);

// The exact "/visuals/reorder" path is registered before
// "/visuals/:visualId" so "reorder" is never treated as a visual id.
dashboardRouter.patch("/visuals/reorder", reorderVisuals);

dashboardRouter.patch("/visuals/:visualId", updateVisual);

dashboardRouter.delete("/visuals/:visualId", deleteVisual);

export { dashboardRouter };
