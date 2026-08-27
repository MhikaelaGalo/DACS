import { Router } from "express";

import { ROLE_PERMISSION_ACCESS } from "../../config/permissions";
import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { getMatrix, updateMatrix } from "./permission.controller";

const permissionRouter = Router();

/*
 * Roles stay the fixed DACS UserRole enum; these endpoints only
 * configure which admin modules each staff role may use. Assigning a
 * role to a user remains PATCH /api/users/:userId/role (Owner-only).
 */
permissionRouter.get(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...ROLE_PERMISSION_ACCESS.viewMatrix),
  getMatrix
);

permissionRouter.patch(
  "/",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles(...ROLE_PERMISSION_ACCESS.updateMatrix),
  updateMatrix
);

export { permissionRouter };
