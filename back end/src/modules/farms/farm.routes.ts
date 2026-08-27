import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import { uploadLimiter } from "../../middleware/rateLimit";
import { uploadSingleImage } from "../../middleware/uploadImage";
import {
  archiveMyFarm,
  createMyFarm,
  listMyFarms,
  updateMyFarm,
  uploadMyFarmLogo,
} from "./farm.controller";

const farmRouter = Router();

farmRouter.get(
  "/me",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  listMyFarms
);

farmRouter.post(
  "/",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  createMyFarm
);

farmRouter.patch(
  "/:farmId",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  updateMyFarm
);

farmRouter.delete(
  "/:farmId",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  archiveMyFarm
);

// PUT because a farm has exactly one current logo; uploading a new one
// replaces (and deletes) the previous file.
farmRouter.put(
  "/:farmId/logo",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  uploadLimiter,
  uploadSingleImage("image"),
  uploadMyFarmLogo
);

export { farmRouter };
