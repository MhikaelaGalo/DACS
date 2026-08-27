import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  getCurrentDacsUser,
  syncCurrentUser,
  testAuth,
} from "./auth.controller";

const authRouter = Router();

authRouter.get("/test", authenticateFirebase, testAuth);
authRouter.post("/sync", authenticateFirebase, syncCurrentUser);
authRouter.get("/me", authenticateFirebase, loadDacsUser, getCurrentDacsUser);

export { authRouter };
