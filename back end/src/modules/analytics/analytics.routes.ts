import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  breederAnalytics,
  customerAnalytics,
  dashboard,
  exportReport,
  fields,
  inquiryAnalytics,
  orderAnalytics,
  paymentAnalytics,
  query,
  seminarAnalytics,
} from "./analytics.controller";

/*
 * Reports expose business-wide numbers, so the whole module is staff
 * only (Requirement 11's role protection).
 */
const analyticsRouter = Router();

analyticsRouter.use(
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF")
);

analyticsRouter.get("/dashboard", dashboard);
analyticsRouter.get("/fields", fields);
analyticsRouter.get("/query", query);
analyticsRouter.get("/customers", customerAnalytics);
analyticsRouter.get("/orders", orderAnalytics);
analyticsRouter.get("/payments", paymentAnalytics);
analyticsRouter.get("/seminars", seminarAnalytics);
analyticsRouter.get("/breeders", breederAnalytics);
analyticsRouter.get("/inquiries", inquiryAnalytics);
analyticsRouter.get("/export", exportReport);

export { analyticsRouter };
