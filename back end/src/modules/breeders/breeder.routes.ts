import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  evaluateEligibility,
  getBreeder,
  getMyBreederStatusHandler,
  issueCertification,
  listBreeders,
  updateMonitoring,
} from "./breeder.controller";

const breederRouter = Router();

breederRouter.use(authenticateFirebase);
breederRouter.use(loadDacsUser);

/*
 * Farmer: own breeder status. Ownership is inherent — the service
 * resolves the customer from the authenticated user, so no IDs are
 * accepted from the request. "/me" is registered before "/:monitoringId".
 */
breederRouter.get("/me", authorizeRoles("CLIENT_FARMER"), getMyBreederStatusHandler);

/*
 * Staff: Certified Breeder Registry.
 */
breederRouter.get(
  "/",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listBreeders
);

breederRouter.get(
  "/:monitoringId",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getBreeder
);

breederRouter.patch(
  "/:monitoringId/monitoring",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  updateMonitoring
);

breederRouter.patch(
  "/:monitoringId/eligibility",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  evaluateEligibility
);

breederRouter.post(
  "/:monitoringId/certify",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  issueCertification
);

export { breederRouter };
