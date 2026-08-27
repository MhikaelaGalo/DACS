import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import { uploadLimiter } from "../../middleware/rateLimit";
import { uploadSinglePaymentProof } from "../../middleware/uploadImage";
import {
  approvePayment,
  denyPayment,
  getIndividualPayment,
  listMyPayments,
  listPayments,
  recordOrderPayment,
  submitPaymentProof,
} from "./payment.controller";

const paymentRouter = Router();

/*
 * Farmer routes. "/me" must be registered before "/:paymentId" so that
 * "me" is never treated as a payment id.
 */
paymentRouter.post(
  "/orders/:orderId/proof",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  uploadLimiter,
  uploadSinglePaymentProof("proof"),
  submitPaymentProof
);

paymentRouter.get(
  "/me",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  listMyPayments
);

/*
 * Staff routes. Customers email their proof of payment to DACS, so staff
 * record the received payment here (JSON, no file) — that row is also
 * what excludes the order from the 14-day auto-cancel sweep.
 */
paymentRouter.post(
  "/orders/:orderId/record",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  recordOrderPayment
);

paymentRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listPayments
);

paymentRouter.get(
  "/:paymentId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getIndividualPayment
);

paymentRouter.patch(
  "/:paymentId/verify",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  approvePayment
);

paymentRouter.patch(
  "/:paymentId/reject",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  denyPayment
);

export { paymentRouter };
