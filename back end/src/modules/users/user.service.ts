import type {
  AccountStatus,
  UserRole,
} from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export interface ActorUser {
  id: string;
  role: UserRole;
}

const userSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  displayName: true,
  phoneNumber: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function getAllUsers() {
  return prisma.user.findMany({
    select: {
      ...userSelect,
      customerProfile: {
        select: {
          id: true,
          customerNumber: true,
          firstName: true,
          lastName: true,
          archivedAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...userSelect,
      customerProfile: {
        include: {
          farms: {
            where: { archivedAt: null },
            orderBy: [{ isPrimary: "desc" }, { farmName: "asc" }],
          },
        },
      },
    },
  });

  if (!user) {
    throw new HttpError(404, "User was not found.");
  }

  return user;
}

/*
 * Pre-authorize a staff member: create their users row from the Google
 * email an Owner supplies, before the person has ever signed in. The
 * row carries no Firebase identity (firebaseUid null) until their first
 * verified sign-in links it via /api/auth/sync. No password of any kind
 * is created or stored — identity always comes from Google/Firebase.
 */
export async function createPreAuthorizedUser(
  actorUserId: string,
  input: {
    email: string;
    role: UserRole;
    displayName: string | null;
    phoneNumber: string | null;
  },
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw new HttpError(
        409,
        "A user with this email address already exists."
      );
    }

    const user = await transaction.user.create({
      data: {
        email: input.email,
        role: input.role,
        status: "ACTIVE",
        displayName: input.displayName,
        phoneNumber: input.phoneNumber,
      },
      select: userSelect,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "USERS",
      action: "USER_CREATED",
      description: `User ${input.email} was pre-authorized with the ${input.role} role.`,
      recordType: "User",
      recordId: user.id,
      metadata: {
        targetUserId: user.id,
        targetEmail: input.email,
        role: input.role,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return user;
  });
}

export async function changeUserRole(
  actorUserId: string,
  targetUserId: string,
  newRole: UserRole,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    /*
     * Nobody may change their own role — an Owner could accidentally
     * remove their own administrative access.
     */
    if (actorUserId === targetUserId) {
      throw new HttpError(403, "You cannot change your own role.");
    }

    const targetUser = await transaction.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
      throw new HttpError(404, "User was not found.");
    }

    if (targetUser.role === newRole) {
      throw new HttpError(409, "The user already has this role.");
    }

    const previousRole = targetUser.role;

    const updatedUser = await transaction.user.update({
      where: { id: targetUser.id },
      data: { role: newRole },
      select: userSelect,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "USERS",
      action: "ROLE_CHANGED",
      description: `User ${targetUser.email} role was changed from ${previousRole} to ${newRole}.`,
      recordType: "User",
      recordId: targetUser.id,
      metadata: {
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        previousRole,
        newRole,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updatedUser;
  });
}

export async function changeUserStatus(
  actor: ActorUser,
  targetUserId: string,
  newStatus: AccountStatus,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    /*
     * Prevent self-suspension and self-disabling: nobody should be able
     * to lock themselves out of DACS.
     */
    if (actor.id === targetUserId) {
      throw new HttpError(403, "You cannot change your own account status.");
    }

    const targetUser = await transaction.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, status: true },
    });

    if (!targetUser) {
      throw new HttpError(404, "User was not found.");
    }

    /*
     * IT staff may manage ordinary accounts, but cannot suspend/disable
     * Owners or other IT staff.
     */
    if (
      actor.role === "IT_STAFF" &&
      (targetUser.role === "OWNER_EXECUTIVE" || targetUser.role === "IT_STAFF")
    ) {
      throw new HttpError(
        403,
        "You do not have permission to change this user's account status."
      );
    }

    if (targetUser.status === newStatus) {
      throw new HttpError(409, "The account already has this status.");
    }

    const previousStatus = targetUser.status;

    const updatedUser = await transaction.user.update({
      where: { id: targetUser.id },
      data: { status: newStatus },
      select: userSelect,
    });

    const action =
      newStatus === "ACTIVE"
        ? "ACCOUNT_REACTIVATED"
        : newStatus === "SUSPENDED"
          ? "ACCOUNT_SUSPENDED"
          : "ACCOUNT_DISABLED";

    await recordActivity(transaction, {
      userId: actor.id,
      module: "USERS",
      action,
      description: `User ${targetUser.email} account status was changed from ${previousStatus} to ${newStatus}.`,
      recordType: "User",
      recordId: targetUser.id,
      metadata: {
        targetUserId: targetUser.id,
        targetEmail: targetUser.email,
        previousStatus,
        newStatus,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updatedUser;
  });
}
