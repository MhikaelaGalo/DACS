import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";
import { notifyStaff } from "../notifications/notification.service";

const CUSTOMER_NUMBER_PREFIX = "DAPG";
const CUSTOMER_NUMBER_LOCK_ID = 43010001;

export interface CustomerProfileOptionalFields {
  middleName?: string | null;
  suffix?: string | null;
  occupation?: string | null;
  phoneNumber?: string | null;
  contactEmail?: string | null;
  facebookName?: string | null;
  addressLine1?: string | null;
  barangay?: string | null;
  cityMunicipality?: string | null;
  province?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

export interface CreateCustomerProfileInput
  extends CustomerProfileOptionalFields {
  firstName: string;
  lastName: string;
}

export interface UpdateCustomerProfileInput
  extends CustomerProfileOptionalFields {
  firstName?: string;
  lastName?: string;
}

export interface CustomerSearchFilters {
  search?: string;
  province?: string;
  region?: string;
  city?: string;
  includeArchived?: boolean;
}

const profileInclude = {
  user: {
    select: {
      email: true,
      role: true,
      status: true,
    },
  },
  farms: {
    where: { archivedAt: null },
  },
} as const;

export async function searchCustomers(filters: CustomerSearchFilters) {
  const where: Prisma.CustomerProfileWhereInput = {};

  if (!filters.includeArchived) {
    where.archivedAt = null;
  }

  if (filters.search) {
    where.OR = [
      { customerNumber: { contains: filters.search, mode: "insensitive" } },
      { firstName: { contains: filters.search, mode: "insensitive" } },
      { middleName: { contains: filters.search, mode: "insensitive" } },
      { lastName: { contains: filters.search, mode: "insensitive" } },
      { occupation: { contains: filters.search, mode: "insensitive" } },
      { phoneNumber: { contains: filters.search, mode: "insensitive" } },
      { contactEmail: { contains: filters.search, mode: "insensitive" } },
      { facebookName: { contains: filters.search, mode: "insensitive" } },
      { cityMunicipality: { contains: filters.search, mode: "insensitive" } },
      /*
       * Staff can also find a customer by one of their (active)
       * farm names.
       */
      {
        farms: {
          some: {
            farmName: { contains: filters.search, mode: "insensitive" },
            archivedAt: null,
          },
        },
      },
    ];
  }

  if (filters.province) {
    where.province = { equals: filters.province, mode: "insensitive" };
  }

  if (filters.region) {
    where.region = { equals: filters.region, mode: "insensitive" };
  }

  if (filters.city) {
    where.cityMunicipality = { equals: filters.city, mode: "insensitive" };
  }

  return prisma.customerProfile.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: profileInclude,
  });
}

export async function getCustomerById(customerId: string) {
  /*
   * findFirst instead of findUnique so archived customers are treated
   * as not found by the normal active-customer endpoint.
   */
  const profile = await prisma.customerProfile.findFirst({
    where: { id: customerId, archivedAt: null },
    include: profileInclude,
  });

  if (!profile) {
    throw new HttpError(404, "Customer was not found.");
  }

  return profile;
}

export async function getCustomerProfileByUserId(userId: string) {
  return prisma.customerProfile.findFirst({
    where: { userId, archivedAt: null },
    include: profileInclude,
  });
}

export async function createCustomerProfileForUser(
  userId: string,
  accountEmail: string,
  input: CreateCustomerProfileInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(${CUSTOMER_NUMBER_LOCK_ID})
    `;

    const existingProfile = await transaction.customerProfile.findUnique({
      where: { userId },
    });

    if (existingProfile) {
      throw new HttpError(
        409,
        "This DACS account already has a customer profile."
      );
    }

    /*
     * Requirement 10: a historical customer imported from spreadsheets
     * has no Firebase account yet (userId null). When someone registers
     * with the same email, they claim that profile instead of creating
     * a duplicate — the DAPG number and history are preserved.
     */
    const historicalProfile = await transaction.customerProfile.findFirst({
      where: {
        userId: null,
        archivedAt: null,
        contactEmail: { equals: accountEmail, mode: "insensitive" },
      },
    });

    if (historicalProfile) {
      const claimed = await transaction.customerProfile.update({
        where: { id: historicalProfile.id },
        data: {
          userId,
          firstName: input.firstName,
          lastName: input.lastName,
          ...(input.middleName !== undefined && { middleName: input.middleName }),
          ...(input.suffix !== undefined && { suffix: input.suffix }),
          ...(input.occupation !== undefined && { occupation: input.occupation }),
          ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
          ...(input.facebookName !== undefined && { facebookName: input.facebookName }),
          ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
          ...(input.barangay !== undefined && { barangay: input.barangay }),
          ...(input.cityMunicipality !== undefined && {
            cityMunicipality: input.cityMunicipality,
          }),
          ...(input.province !== undefined && { province: input.province }),
          ...(input.region !== undefined && { region: input.region }),
          ...(input.postalCode !== undefined && { postalCode: input.postalCode }),
        },
        include: profileInclude,
      });

      await recordActivity(transaction, {
        userId,
        module: "CUSTOMERS",
        action: "CUSTOMER_PROFILE_LINKED",
        description: `Historical customer profile ${claimed.customerNumber} was linked to a new DACS account.`,
        recordType: "CustomerProfile",
        recordId: claimed.id,
        metadata: { customerNumber: claimed.customerNumber },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      await notifyStaff(transaction, userId, {
        type: "NEW_CUSTOMER",
        title: "Returning customer registered",
        message: `Historical customer ${claimed.customerNumber} (${claimed.firstName} ${claimed.lastName}) linked their profile to a new account.`,
        recordType: "CustomerProfile",
        recordId: claimed.id,
      });

      return claimed;
    }

    // Scoped to DAPG- numbers so records with other prefixes (legacy
    // fixtures like TEST-ARCHIVE-001) can never derail the sequence.
    const lastProfile = await transaction.customerProfile.findFirst({
      where: { customerNumber: { startsWith: `${CUSTOMER_NUMBER_PREFIX}-` } },
      orderBy: { customerNumber: "desc" },
      select: { customerNumber: true },
    });

    const parsedLast = lastProfile
      ? Number.parseInt(lastProfile.customerNumber.split("-")[1] ?? "0", 10)
      : 0;

    const lastNumber = Number.isFinite(parsedLast) ? parsedLast : 0;

    const customerNumber = `${CUSTOMER_NUMBER_PREFIX}-${String(
      lastNumber + 1
    ).padStart(5, "0")}`;

    const profile = await transaction.customerProfile.create({
      data: {
        customerNumber,
        userId,
        firstName: input.firstName,
        middleName: input.middleName,
        lastName: input.lastName,
        suffix: input.suffix,
        occupation: input.occupation,
        phoneNumber: input.phoneNumber,
        contactEmail: input.contactEmail?.trim() || accountEmail,
        facebookName: input.facebookName,
        addressLine1: input.addressLine1,
        barangay: input.barangay,
        cityMunicipality: input.cityMunicipality,
        province: input.province,
        region: input.region,
        postalCode: input.postalCode,
      },
      include: profileInclude,
    });

    await recordActivity(transaction, {
      userId,
      module: "CUSTOMERS",
      action: "CUSTOMER_PROFILE_CREATED",
      description: `Customer profile ${customerNumber} was created.`,
      recordType: "CustomerProfile",
      recordId: profile.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await notifyStaff(transaction, userId, {
      type: "NEW_CUSTOMER",
      title: "New customer registered",
      message: `${profile.firstName} ${profile.lastName} registered as ${customerNumber}.`,
      recordType: "CustomerProfile",
      recordId: profile.id,
    });

    return profile;
  });
}

export async function updateCustomerProfileForUser(
  userId: string,
  input: UpdateCustomerProfileInput,
  meta: RequestMeta
) {
  /*
   * The profile update and its activity log belong together: if one fails,
   * neither should be saved. The transaction guarantees that.
   */
  return prisma.$transaction(async (transaction) => {
    const existingProfile = await transaction.customerProfile.findUnique({
      where: { userId },
    });

    if (!existingProfile) {
      throw new HttpError(
        404,
        "No customer profile is linked to this DACS account."
      );
    }

    if (existingProfile.archivedAt) {
      throw new HttpError(403, "This customer profile is archived.");
    }

    const data: Prisma.CustomerProfileUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.middleName !== undefined) data.middleName = input.middleName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.suffix !== undefined) data.suffix = input.suffix;
    if (input.occupation !== undefined) data.occupation = input.occupation;
    if (input.phoneNumber !== undefined) data.phoneNumber = input.phoneNumber;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
    if (input.facebookName !== undefined) data.facebookName = input.facebookName;
    if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
    if (input.barangay !== undefined) data.barangay = input.barangay;
    if (input.cityMunicipality !== undefined)
      data.cityMunicipality = input.cityMunicipality;
    if (input.province !== undefined) data.province = input.province;
    if (input.region !== undefined) data.region = input.region;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "No editable fields were provided.");
    }

    const profile = await transaction.customerProfile.update({
      where: { id: existingProfile.id },
      data,
      include: profileInclude,
    });

    await recordActivity(transaction, {
      userId,
      module: "CUSTOMERS",
      action: "CUSTOMER_PROFILE_UPDATED",
      description: `Customer profile ${profile.customerNumber} was updated.`,
      recordType: "CustomerProfile",
      recordId: profile.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return profile;
  });
}

/*
 * Staff correction of a customer's record (Requirement: Administrative
 * Staff fix wrong names, addresses, and contact details). Same field
 * set and validation as the farmer's self-service update; only the
 * lookup differs — by customer ID instead of the authenticated user.
 * The profile's contactEmail is plain contact data; the LOGIN email
 * lives on the users table and is never touched here.
 */
export async function updateCustomerProfileByStaff(
  actorUserId: string,
  customerId: string,
  input: UpdateCustomerProfileInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existingProfile = await transaction.customerProfile.findFirst({
      where: { id: customerId, archivedAt: null },
    });

    if (!existingProfile) {
      throw new HttpError(404, "Customer was not found.");
    }

    const data: Prisma.CustomerProfileUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.middleName !== undefined) data.middleName = input.middleName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.suffix !== undefined) data.suffix = input.suffix;
    if (input.occupation !== undefined) data.occupation = input.occupation;
    if (input.phoneNumber !== undefined) data.phoneNumber = input.phoneNumber;
    if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
    if (input.facebookName !== undefined) data.facebookName = input.facebookName;
    if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
    if (input.barangay !== undefined) data.barangay = input.barangay;
    if (input.cityMunicipality !== undefined)
      data.cityMunicipality = input.cityMunicipality;
    if (input.province !== undefined) data.province = input.province;
    if (input.region !== undefined) data.region = input.region;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "No editable fields were provided.");
    }

    const profile = await transaction.customerProfile.update({
      where: { id: existingProfile.id },
      data,
      include: profileInclude,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "CUSTOMERS",
      action: "CUSTOMER_PROFILE_UPDATED_BY_STAFF",
      description: `Customer profile ${profile.customerNumber} was updated by staff.`,
      recordType: "CustomerProfile",
      recordId: profile.id,
      metadata: {
        customerNumber: profile.customerNumber,
        updatedFields: Object.keys(data),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return profile;
  });
}

export async function updateCustomerProfileImage(
  userId: string,
  imageUrl: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existingProfile = await transaction.customerProfile.findFirst({
      where: { userId, archivedAt: null },
      select: { id: true, customerNumber: true, profileImageUrl: true },
    });

    if (!existingProfile) {
      throw new HttpError(
        404,
        "No customer profile is linked to this DACS account."
      );
    }

    const profile = await transaction.customerProfile.update({
      where: { id: existingProfile.id },
      data: { profileImageUrl: imageUrl },
      include: profileInclude,
    });

    await recordActivity(transaction, {
      userId,
      module: "CUSTOMERS",
      action: "CUSTOMER_PROFILE_IMAGE_UPDATED",
      description: `Profile image for ${existingProfile.customerNumber} was updated.`,
      recordType: "CustomerProfile",
      recordId: existingProfile.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { profile, previousImageUrl: existingProfile.profileImageUrl };
  });
}

export async function archiveCustomerProfile(
  customerId: string,
  actorUserId: string,
  meta: RequestMeta
) {
  /*
   * The archive and its audit log succeed or fail together. The lookup
   * only matches ACTIVE customers, so archiving twice (or archiving an
   * unknown ID) both produce the same 404.
   */
  return prisma.$transaction(async (transaction) => {
    const existingProfile = await transaction.customerProfile.findFirst({
      where: { id: customerId, archivedAt: null },
      select: { id: true, customerNumber: true },
    });

    if (!existingProfile) {
      throw new HttpError(
        404,
        "Customer was not found or is already archived."
      );
    }

    const profile = await transaction.customerProfile.update({
      where: { id: existingProfile.id },
      data: { archivedAt: new Date() },
      select: {
        id: true,
        customerNumber: true,
        firstName: true,
        lastName: true,
        archivedAt: true,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "CUSTOMERS",
      action: "CUSTOMER_PROFILE_ARCHIVED",
      description: `Customer profile ${profile.customerNumber} was archived.`,
      recordType: "CustomerProfile",
      recordId: profile.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return profile;
  });
}
