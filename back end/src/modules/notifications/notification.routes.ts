import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import {
  getMyPreferences,
  getMyUnreadCount,
  listMyNotifications,
  readAllNotifications,
  readNotification,
  updateMyPreferences,
} from "./notification.controller";

/*
 * Every DACS user (staff and farmers alike) has their own notification
 * feed, so no role guard — authentication is enough. Named routes must
 * be registered before "/:notificationId".
 */
const notificationRouter = Router();

notificationRouter.use(authenticateFirebase, loadDacsUser);

notificationRouter.get("/", listMyNotifications);
notificationRouter.get("/unread-count", getMyUnreadCount);
notificationRouter.get("/preferences", getMyPreferences);
notificationRouter.patch("/preferences", updateMyPreferences);
notificationRouter.patch("/read-all", readAllNotifications);
notificationRouter.patch("/:notificationId/read", readNotification);

export { notificationRouter };
