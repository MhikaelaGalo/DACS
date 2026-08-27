import { Router } from "express";

import { USER_MANAGEMENT_ACCESS } from "../../config/permissions";
import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  createUser,
  getIndividualUser,
  listUsers,
  updateUserRole,
  updateUserStatus,
} from "./user.controller";

const userRouter = Router();

userRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...USER_MANAGEMENT_ACCESS.viewUsers),
  listUsers
);

userRouter.post(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...USER_MANAGEMENT_ACCESS.createUser),
  createUser
);

userRouter.get(
  "/:userId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...USER_MANAGEMENT_ACCESS.viewUser),
  getIndividualUser
);

userRouter.patch(
  "/:userId/role",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...USER_MANAGEMENT_ACCESS.changeRole),
  updateUserRole
);

userRouter.patch(
  "/:userId/status",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...USER_MANAGEMENT_ACCESS.changeStatus),
  updateUserStatus
);

export { userRouter };
