import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import {
  defaultPermissionGrants,
  MATRIX_ROLES,
  PERMISSION_MODULES,
  type MatrixRole,
  type PermissionModule,
} from "../../config/permissions";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

/*
 * The configurable role-permission matrix (Settings > Roles and
 * Permission). Rows in role_permissions OVERRIDE the code defaults from
 * src/config/permissions.ts; the API always answers with the EFFECTIVE
 * matrix so the frontend never has to merge.
 *
 * Scope note: matrix grants gate admin PAGES in the frontend. The
 * backend's hard route guards (authorizeRoles + the access lists in
 * config/permissions.ts) are the security boundary and are never
 * derived from these rows — a matrix change can therefore never grant
 * anyone new API access.
 */

export interface PermissionUpdate {
  role: MatrixRole;
  permissionModule: PermissionModule;
  allowed: boolean;
}

async function buildEffectiveMatrix(client: Prisma.TransactionClient) {
  const grants = defaultPermissionGrants();

  const overrides = await client.rolePermission.findMany();

  for (const override of overrides) {
    if (
      MATRIX_ROLES.includes(override.role as MatrixRole) &&
      PERMISSION_MODULES.includes(
        override.permissionModule as PermissionModule
      )
    ) {
      grants[override.permissionModule as PermissionModule][
        override.role as MatrixRole
      ] = override.allowed;
    }
  }

  return {
    roles: [...MATRIX_ROLES],
    modules: [...PERMISSION_MODULES],
    grants,
  };
}

export async function getPermissionMatrix() {
  return buildEffectiveMatrix(prisma);
}

export async function updatePermissionMatrix(
  actor: { id: string; role: string },
  updates: PermissionUpdate[],
  meta: RequestMeta
) {
  const seenPairs = new Set<string>();

  for (const update of updates) {
    /*
     * The Owner always has every module — otherwise the matrix could
     * lock its own administrators out of the screen that manages it.
     */
    if ((update.role as string) === "OWNER_EXECUTIVE") {
      throw new HttpError(
        400,
        "Owner permissions cannot be modified — the Owner always has full access."
      );
    }

    /*
     * Nobody widens (or narrows) their own role's access. The Owner is
     * unaffected: their row is immutable anyway.
     */
    if (update.role === actor.role) {
      throw new HttpError(
        403,
        "You cannot change the permissions of your own role."
      );
    }

    const pairKey = `${update.role}::${update.permissionModule}`;
    if (seenPairs.has(pairKey)) {
      throw new HttpError(
        400,
        "The same role and module pair cannot appear more than once."
      );
    }
    seenPairs.add(pairKey);
  }

  return prisma.$transaction(async (transaction) => {
    const changes = [];

    for (const update of updates) {
      const existing = await transaction.rolePermission.findUnique({
        where: {
          role_permissionModule: {
            role: update.role,
            permissionModule: update.permissionModule,
          },
        },
      });

      const previousAllowed =
        existing?.allowed ??
        defaultPermissionGrants()[update.permissionModule][update.role];

      await transaction.rolePermission.upsert({
        where: {
          role_permissionModule: {
            role: update.role,
            permissionModule: update.permissionModule,
          },
        },
        create: {
          role: update.role,
          permissionModule: update.permissionModule,
          allowed: update.allowed,
          updatedByUserId: actor.id,
        },
        update: {
          allowed: update.allowed,
          updatedByUserId: actor.id,
        },
      });

      changes.push({
        role: update.role,
        permissionModule: update.permissionModule,
        previousAllowed,
        allowed: update.allowed,
      });
    }

    await recordActivity(transaction, {
      userId: actor.id,
      module: "PERMISSIONS",
      action: "PERMISSION_MATRIX_UPDATED",
      description: `The role-permission matrix was updated (${changes.length} change(s)).`,
      metadata: { changes },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return buildEffectiveMatrix(transaction);
  });
}
