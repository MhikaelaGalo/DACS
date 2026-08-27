import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import {
  editOrder,
  getIndividualOrder,
  getMyOrder,
  listMyOrders,
  listOrders,
  submitOrder,
  updateOrderPaymentSchedule,
  updateOrderStatus,
} from "./order.controller";

const orderRouter = Router();

/*
 * Farmer routes. "/me" routes must be registered before "/:orderId" so
 * that "me" is never treated as an order id.
 */
orderRouter.post(
  "/",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  submitOrder
);

orderRouter.get(
  "/me",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  listMyOrders
);

orderRouter.get(
  "/me/:orderId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  getMyOrder
);

/*
 * Staff routes.
 */
orderRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listOrders
);

orderRouter.get(
  "/:orderId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getIndividualOrder
);

// Staff quotation editing (items, logistics, shipping fee). Totals are
// recalculated by the service; only PENDING/APPROVED orders qualify.
orderRouter.patch(
  "/:orderId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  editOrder
);

orderRouter.patch(
  "/:orderId/status",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  updateOrderStatus
);

orderRouter.patch(
  "/:orderId/payment-schedule",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  updateOrderPaymentSchedule
);

export { orderRouter };
