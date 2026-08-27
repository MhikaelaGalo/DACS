import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  createNewFaq,
  editFaq,
  listAllFaqs,
  listPublishedFaqs,
  publishFaq,
  removeFaq,
  reorderAllFaqs,
} from "./faq.controller";

const faqRouter = Router();

/*
 * Public: the website FAQ page works without logging in. Only
 * published FAQs are returned.
 */
faqRouter.get("/", listPublishedFaqs);

/*
 * Staff management. Exact paths ("/manage", "/reorder") are registered
 * before "/:faqId" patterns.
 */
const staffOnly = [
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
] as const;

faqRouter.get("/manage", ...staffOnly, listAllFaqs);

faqRouter.post("/", ...staffOnly, createNewFaq);

faqRouter.patch("/reorder", ...staffOnly, reorderAllFaqs);

faqRouter.patch("/:faqId", ...staffOnly, editFaq);

faqRouter.patch("/:faqId/publish", ...staffOnly, publishFaq);

faqRouter.delete("/:faqId", ...staffOnly, removeFaq);

export { faqRouter };
