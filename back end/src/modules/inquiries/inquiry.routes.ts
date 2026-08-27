import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import {
  assignInquiry,
  changeInquiryStatus,
  classifyInquiry,
  createInquiry,
  getInquiry,
  getMyInquiry,
  listInquiries,
  listMyInquiries,
  recordEmailResponse,
} from "./inquiry.controller";

const inquiryRouter = Router();

inquiryRouter.use(authenticateFirebase);
inquiryRouter.use(loadDacsUser);

/*
 * Farmer routes. "/me" paths are registered before "/:ticketId".
 */
inquiryRouter.post(
  "/",
  authorizeRoles("CLIENT_FARMER"),
  requireVerifiedEmail,
  createInquiry
);

inquiryRouter.get("/me", authorizeRoles("CLIENT_FARMER"), listMyInquiries);

inquiryRouter.get(
  "/me/:ticketId",
  authorizeRoles("CLIENT_FARMER"),
  getMyInquiry
);

/*
 * Staff routes.
 */
inquiryRouter.get(
  "/",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listInquiries
);

inquiryRouter.get(
  "/:ticketId",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getInquiry
);

inquiryRouter.patch(
  "/:ticketId/classification",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  classifyInquiry
);

inquiryRouter.patch(
  "/:ticketId/assignment",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  assignInquiry
);

inquiryRouter.patch(
  "/:ticketId/status",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  changeInquiryStatus
);

inquiryRouter.patch(
  "/:ticketId/email-response",
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  recordEmailResponse
);

export { inquiryRouter };
