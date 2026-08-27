import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  createVisual,
  deleteVisual,
  listVisuals,
  reorderVisuals,
  updateVisual,
} from "./dashboard.controller";

const dashboardRouter = Router();

/*
 * Every staff role may lay out their own dashboard (the Dashboard page
 * is available to all staff in the admin frontend); farmers have no
 * dashboard. Each user only ever sees and changes their own visuals.
 */
const staffOnly = [
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF", "IT_STAFF"),
] as const;

dashboardRouter.get("/visuals", ...staffOnly, listVisuals);

dashboardRouter.post("/visuals", ...staffOnly, createVisual);

// The exact "/visuals/reorder" path is registered before
// "/visuals/:visualId" so "reorder" is never treated as a visual id.
dashboardRouter.patch("/visuals/reorder", ...staffOnly, reorderVisuals);

dashboardRouter.patch("/visuals/:visualId", ...staffOnly, updateVisual);

dashboardRouter.delete("/visuals/:visualId", ...staffOnly, deleteVisual);

export { dashboardRouter };
