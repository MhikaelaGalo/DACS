import { Prisma } from "../../../generated/prisma/client";
import type { NotificationType } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export const NOTIFICATION_TYPES: NotificationType[] = [
  "NEW_CUSTOMER",
  "NEW_ORDER",
  "NEW_TICKET",
  "CERTIFICATE_APPROVED",
  "CERTIFICATE_EXPIRED",
  "ORDER_AUTO_CANCELLED",
];

export interface NotificationContent {
  type: NotificationType;
  title: string;
  message: string;
  recordType?: string;
  recordId?: string;
}

/*
 * A missing preference row means the type is enabled — rows exist only
 * for users who changed a preference. Given candidate recipients, this
 * removes the ones who opted out of the type.
 */
async function filterByPreference(
  client: Prisma.TransactionClient,
  userIds: string[],
  type: NotificationType
): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }

  const optOuts = await client.notificationPreference.findMany({
    where: { userId: { in: userIds }, type, enabled: false },
    select: { userId: true },
  });

  const optedOut = new Set(optOuts.map((preference) => preference.userId));

  return userIds.filter((userId) => !optedOut.has(userId));
}

/*
 * Fan out one notification row per active staff user (Owner +
 * Administrative Staff), so each recipient has their own read state.
 * The actor is excluded — nobody needs a notification about their own
 * action.
 */
export async function notifyStaff(
  client: Prisma.TransactionClient,
  actorUserId: string | null,
  content: NotificationContent
): Promise<void> {
  const staff = await client.user.findMany({
    where: {
      role: { in: ["OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"] },
      status: "ACTIVE",
      ...(actorUserId ? { id: { not: actorUserId } } : {}),
    },
    select: { id: true },
  });

  const recipients = await filterByPreference(
    client,
    staff.map((user) => user.id),
    content.type
  );

  if (recipients.length === 0) {
    return;
  }

  await client.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: content.type,
      title: content.title,
      message: content.message,
      recordType: content.recordType ?? null,
      recordId: content.recordId ?? null,
    })),
  });
}

/*
 * Notify a single user (e.g. the farmer whose certificate was approved
 * or expired). Silently skips opted-out recipients.
 */
export async function notifyUser(
  client: Prisma.TransactionClient,
  userId: string,
  content: NotificationContent
): Promise<void> {
  const recipients = await filterByPreference(client, [userId], content.type);

  if (recipients.length === 0) {
    return;
  }

  await client.notification.create({
    data: {
      userId,
      type: content.type,
      title: content.title,
      message: content.message,
      recordType: content.recordType ?? null,
      recordId: content.recordId ?? null,
    },
  });
}

const NOTIFICATION_PAGE_SIZE_MAX = 100;

export async function getNotificationsForUser(
  userId: string,
  filters: { unreadOnly: boolean; page: number; pageSize: number }
) {
  const pageSize = Math.min(filters.pageSize, NOTIFICATION_PAGE_SIZE_MAX);

  const where = {
    userId,
    ...(filters.unreadOnly ? { readAt: null } : {}),
  };

  const [total, notifications] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    page: filters.page,
    pageSize,
    notifications,
  };
}

export async function getUnreadNotificationCount(
  userId: string
): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null },
  });
}

/*
 * Ownership is enforced by the combined id + userId query: a missing
 * notification and someone else's notification both come back null.
 */
export async function markNotificationAsRead(
  userId: string,
  notificationId: string
) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    throw new HttpError(404, "Notification was not found.");
  }

  if (notification.readAt) {
    throw new HttpError(409, "This notification has already been read.");
  }

  return prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return { markedRead: result.count };
}

/*
 * Preferences are returned for every type, merging stored opt-outs over
 * the enabled-by-default baseline.
 */
export async function getNotificationPreferencesForUser(userId: string) {
  const stored = await prisma.notificationPreference.findMany({
    where: { userId },
  });

  const storedByType = new Map(
    stored.map((preference) => [preference.type, preference.enabled])
  );

  return NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: storedByType.get(type) ?? true,
  }));
}

export interface PreferenceUpdateInput {
  type: NotificationType;
  enabled: boolean;
}

export async function updateNotificationPreferencesForUser(
  userId: string,
  updates: PreferenceUpdateInput[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    for (const update of updates) {
      await transaction.notificationPreference.upsert({
        where: { userId_type: { userId, type: update.type } },
        create: { userId, type: update.type, enabled: update.enabled },
        update: { enabled: update.enabled },
      });
    }

    await recordActivity(transaction, {
      userId,
      module: "NOTIFICATIONS",
      action: "NOTIFICATION_PREFERENCES_UPDATED",
      description: `Notification preferences were updated for ${updates.length} type(s).`,
      recordType: "NotificationPreference",
      metadata: {
        updates: updates.map((update) => ({
          type: update.type,
          enabled: update.enabled,
        })),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const stored = await transaction.notificationPreference.findMany({
      where: { userId },
    });

    const storedByType = new Map(
      stored.map((preference) => [preference.type, preference.enabled])
    );

    return NOTIFICATION_TYPES.map((type) => ({
      type,
      enabled: storedByType.get(type) ?? true,
    }));
  });
}
