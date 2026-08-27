import type { DecodedIdToken } from "firebase-admin/auth";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

/*
 * The Google/Firebase ID token's name claim, when present. Used to keep
 * users.display_name in sync with the person's real profile name.
 */
function tokenDisplayName(firebaseUser: DecodedIdToken): string | null {
  return typeof firebaseUser.name === "string" && firebaseUser.name.trim()
    ? firebaseUser.name.trim()
    : null;
}

export async function syncFirebaseUser(
  firebaseUser: DecodedIdToken,
  meta: RequestMeta
) {
  const email = firebaseUser.email?.toLowerCase();

  if (!email) {
    throw new HttpError(400, "The Firebase account has no email address.");
  }

  const displayName = tokenDisplayName(firebaseUser);

  const existingUser = await prisma.user.findUnique({
    where: { firebaseUid: firebaseUser.uid },
  });

  if (existingUser) {
    const user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email,
        lastLoginAt: new Date(),
        ...(displayName ? { displayName } : {}),
      },
    });

    await recordActivity(prisma, {
      userId: user.id,
      module: "AUTH",
      action: "ACCOUNT_SYNCED",
      description: `DACS account synchronized for ${email}.`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user, created: false };
  }

  /*
   * Pre-authorization: an Owner may have created this user's row (by
   * Google email, no Firebase identity yet) via POST /api/users. The
   * first sign-in claims that row — but only when the identity
   * provider vouches for the email (email_verified), so nobody can
   * claim a staff role by merely registering a Firebase password
   * account with someone else's address.
   */
  const preAuthorized = await prisma.user.findUnique({ where: { email } });

  if (preAuthorized) {
    if (preAuthorized.firebaseUid) {
      throw new HttpError(
        409,
        "This email address is already linked to a different sign-in account."
      );
    }

    if (firebaseUser.email_verified !== true) {
      throw new HttpError(
        403,
        "Please verify your email address, then sign in again."
      );
    }

    const user = await prisma.user.update({
      where: { id: preAuthorized.id },
      data: {
        firebaseUid: firebaseUser.uid,
        lastLoginAt: new Date(),
        ...(displayName ? { displayName } : {}),
      },
    });

    await recordActivity(prisma, {
      userId: user.id,
      module: "AUTH",
      action: "ACCOUNT_LINKED",
      description: `Pre-authorized DACS account for ${email} was linked to its sign-in identity.`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { user, created: false };
  }

  const user = await prisma.user.create({
    data: {
      firebaseUid: firebaseUser.uid,
      email,
      lastLoginAt: new Date(),
      ...(displayName ? { displayName } : {}),
    },
  });

  await recordActivity(prisma, {
    userId: user.id,
    module: "AUTH",
    action: "ACCOUNT_CREATED",
    description: `DACS account created for ${email}.`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { user, created: true };
}
