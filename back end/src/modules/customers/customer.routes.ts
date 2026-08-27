import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import { uploadLimiter } from "../../middleware/rateLimit";
import { uploadSingleImage } from "../../middleware/uploadImage";
import { updateCustomerFarmByStaff } from "../farms/farm.controller";
import {
  archiveCustomer,
  createMyCustomerProfile,
  getCustomer,
  getMyCustomerProfile,
  listCustomers,
  updateCustomerByStaff,
  updateMyCustomerProfile,
  uploadMyProfileImage,
} from "./customer.controller";

const customerRouter = Router();

customerRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listCustomers
);

// "/me" routes must be registered before "/:customerId" so that "me"
// is never treated as a customer id.
customerRouter.get(
  "/me",
  authenticateFirebase,
  loadDacsUser,
  getMyCustomerProfile
);

customerRouter.post(
  "/me",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  createMyCustomerProfile
);

customerRouter.patch(
  "/me",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  updateMyCustomerProfile
);

// PUT because a customer has exactly one current profile image;
// uploading a new one replaces (and deletes) the previous file.
customerRouter.put(
  "/me/profile-image",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  uploadLimiter,
  uploadSingleImage("image"),
  uploadMyProfileImage
);

customerRouter.get(
  "/:customerId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getCustomer
);

// Staff correction of customer records (Administrative Staff fix wrong
// names, addresses, and contact details). Registered after "/me" so
// "me" is never treated as a customer id.
customerRouter.patch(
  "/:customerId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  updateCustomerByStaff
);

// Staff correction of a customer's farm record.
customerRouter.patch(
  "/:customerId/farms/:farmId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  updateCustomerFarmByStaff
);

customerRouter.delete(
  "/:customerId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  archiveCustomer
);

export { customerRouter };
