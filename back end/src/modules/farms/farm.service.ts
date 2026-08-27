import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export interface FarmInput {
  farmName?: string;
  addressLine1?: string | null;
  barangay?: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
  region?: string | null;
  postalCode?: string | null;
  isPrimary?: boolean;
}

async function getActiveProfileForUser(userId: string) {
  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    throw new HttpError(
      404,
      "No customer profile is linked to this DACS account. Create a customer profile first."
    );
  }

  if (profile.archivedAt) {
    throw new HttpError(403, "This customer profile is archived.");
  }

  return profile;
}

async function getOwnedActiveFarm(
  transaction: Prisma.TransactionClient,
  userId: string,
  farmId: string
) {
  const farm = await transaction.farm.findUnique({
    where: { id: farmId },
    include: {
      customerProfile: {
        select: { id: true, userId: true, archivedAt: true },
      },
    },
  });

  /*
   * Ownership protection: a farm that does not exist, is archived,
   * belongs to another customer, or belongs to an ARCHIVED customer
   * profile all produce the same 404 so outsiders cannot even learn
   * that a farm ID exists.
   */
  if (
    !farm ||
    farm.archivedAt ||
    farm.customerProfile.userId !== userId ||
    farm.customerProfile.archivedAt
  ) {
    throw new HttpError(
      404,
      "Farm was not found or does not belong to this account."
    );
  }

  return farm;
}

export async function getFarmsForUser(userId: string) {
  const profile = await getActiveProfileForUser(userId);

  const farms = await prisma.farm.findMany({
    where: {
      customerProfileId: profile.id,
      archivedAt: null,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return {
    customerNumber: profile.customerNumber,
    farms,
  };
}

export async function createFarmForUser(
  userId: string,
  input: FarmInput & { farmName: string },
  meta: RequestMeta
) {
  const profile = await getActiveProfileForUser(userId);

  return prisma.$transaction(async (transaction) => {
    const activeFarmCount = await transaction.farm.count({
      where: { customerProfileId: profile.id, archivedAt: null },
    });

    // The customer's first farm automatically becomes the primary farm.
    const willBePrimary = input.isPrimary === true || activeFarmCount === 0;

    if (willBePrimary) {
      await transaction.farm.updateMany({
        where: {
          customerProfileId: profile.id,
          archivedAt: null,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    const farm = await transaction.farm.create({
      data: {
        customerProfileId: profile.id,
        farmName: input.farmName,
        addressLine1: input.addressLine1,
        barangay: input.barangay,
        cityMunicipality: input.cityMunicipality,
        province: input.province,
        region: input.region,
        postalCode: input.postalCode,
        isPrimary: willBePrimary,
      },
    });

    await recordActivity(transaction, {
      userId,
      module: "FARMS",
      action: "FARM_CREATED",
      description: `Farm "${farm.farmName}" was created under ${profile.customerNumber}.`,
      recordType: "Farm",
      recordId: farm.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return farm;
  });
}

/*
 * Shared update core for the farmer and staff endpoints: field mapping,
 * the primary-farm rules, and the row update. Callers do their own
 * lookup (ownership vs. staff access) and their own activity log.
 */
async function applyFarmUpdate(
  transaction: Prisma.TransactionClient,
  farm: { id: string; isPrimary: boolean; customerProfileId: string },
  input: FarmInput
) {
  const data: Prisma.FarmUpdateInput = {};
  if (input.farmName !== undefined) data.farmName = input.farmName;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.barangay !== undefined) data.barangay = input.barangay;
  if (input.cityMunicipality !== undefined)
    data.cityMunicipality = input.cityMunicipality;
  if (input.province !== undefined) data.province = input.province;
  if (input.region !== undefined) data.region = input.region;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;

  if (Object.keys(data).length === 0) {
    throw new HttpError(400, "No editable fields were provided.");
  }

  /*
   * A primary farm cannot simply be switched off — the customer should
   * make another farm primary instead, which demotes this one.
   */
  if (farm.isPrimary && input.isPrimary === false) {
    throw new HttpError(
      400,
      "A primary farm cannot simply be unset. Make another farm primary instead."
    );
  }

  if (input.isPrimary === true) {
    await transaction.farm.updateMany({
      where: {
        customerProfileId: farm.customerProfileId,
        archivedAt: null,
        isPrimary: true,
        id: { not: farm.id },
      },
      data: { isPrimary: false },
    });
  }

  const updatedFarm = await transaction.farm.update({
    where: { id: farm.id },
    data,
  });

  return { updatedFarm, updatedFields: Object.keys(data) };
}

export async function updateFarmForUser(
  userId: string,
  farmId: string,
  input: FarmInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const farm = await getOwnedActiveFarm(transaction, userId, farmId);

    const { updatedFarm, updatedFields } = await applyFarmUpdate(
      transaction,
      {
        id: farm.id,
        isPrimary: farm.isPrimary,
        customerProfileId: farm.customerProfile.id,
      },
      input
    );

    await recordActivity(transaction, {
      userId,
      module: "FARMS",
      action: "FARM_UPDATED",
      description: `Farm "${updatedFarm.farmName}" was updated.`,
      recordType: "Farm",
      recordId: updatedFarm.id,
      metadata: { updatedFields },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updatedFarm;
  });
}

/*
 * Staff correction of a customer's farm record. The farm must belong to
 * the customer named in the URL; a farm that does not exist, is
 * archived, or belongs to a different customer is reported as missing,
 * exactly like the ownership checks on the farmer endpoints.
 */
export async function updateFarmByStaff(
  actorUserId: string,
  customerId: string,
  farmId: string,
  input: FarmInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const farm = await transaction.farm.findUnique({
      where: { id: farmId },
      include: {
        customerProfile: {
          select: { id: true, customerNumber: true, archivedAt: true },
        },
      },
    });

    if (
      !farm ||
      farm.archivedAt ||
      farm.customerProfile.id !== customerId ||
      farm.customerProfile.archivedAt
    ) {
      throw new HttpError(404, "Farm was not found for this customer.");
    }

    const { updatedFarm, updatedFields } = await applyFarmUpdate(
      transaction,
      {
        id: farm.id,
        isPrimary: farm.isPrimary,
        customerProfileId: farm.customerProfile.id,
      },
      input
    );

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FARMS",
      action: "FARM_UPDATED_BY_STAFF",
      description: `Farm "${updatedFarm.farmName}" of ${farm.customerProfile.customerNumber} was updated by staff.`,
      recordType: "Farm",
      recordId: updatedFarm.id,
      metadata: {
        customerNumber: farm.customerProfile.customerNumber,
        updatedFields,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updatedFarm;
  });
}

export async function archiveFarmForUser(
  userId: string,
  farmId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const farm = await getOwnedActiveFarm(transaction, userId, farmId);

    const archivedFarm = await transaction.farm.update({
      where: { id: farm.id },
      data: {
        archivedAt: new Date(),
        isPrimary: false,
      },
    });

    /*
     * If the archived farm was the primary farm, promote the oldest
     * remaining active farm so the customer keeps a primary farm.
     */
    if (farm.isPrimary) {
      const replacementFarm = await transaction.farm.findFirst({
        where: {
          customerProfileId: farm.customerProfile.id,
          archivedAt: null,
          id: { not: farm.id },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (replacementFarm) {
        await transaction.farm.update({
          where: { id: replacementFarm.id },
          data: { isPrimary: true },
        });
      }
    }

    await recordActivity(transaction, {
      userId,
      module: "FARMS",
      action: "FARM_ARCHIVED",
      description: `Farm "${archivedFarm.farmName}" was archived.`,
      recordType: "Farm",
      recordId: archivedFarm.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return archivedFarm;
  });
}

export async function updateFarmLogoForUser(
  userId: string,
  farmId: string,
  farmLogoUrl: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const farm = await getOwnedActiveFarm(transaction, userId, farmId);
    const previousLogoUrl = farm.farmLogoUrl;

    const updatedFarm = await transaction.farm.update({
      where: { id: farm.id },
      data: { farmLogoUrl },
    });

    await recordActivity(transaction, {
      userId,
      module: "FARMS",
      action: "FARM_LOGO_UPDATED",
      description: `Logo for farm "${updatedFarm.farmName}" was updated.`,
      recordType: "Farm",
      recordId: updatedFarm.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { farm: updatedFarm, previousLogoUrl };
  });
}
