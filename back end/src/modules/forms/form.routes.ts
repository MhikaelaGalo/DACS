import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  getForm,
  listForms,
  patchForm,
  postForm,
  publishForm,
  removeForm,
} from "./form.controller";

/*
 * Admin form builder: staff-only content management, same roles as the
 * other content modules (seminar content, FAQs). Customer-facing
 * submission endpoints are future work — the tables already exist.
 */
const formRouter = Router();

const staffOnly = [
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
] as const;

formRouter.get("/", ...staffOnly, listForms);
formRouter.post("/", ...staffOnly, postForm);
formRouter.get("/:formId", ...staffOnly, getForm);
formRouter.patch("/:formId", ...staffOnly, patchForm);
formRouter.patch("/:formId/publish", ...staffOnly, publishForm);

// Deletes for real only when the form has no submissions; otherwise the
// form is archived so customer-entered history survives.
formRouter.delete("/:formId", ...staffOnly, removeForm);

export { formRouter };
