import type { NextFunction, Request, Response } from "express";

import {
  optionalEmail,
  optionalPhoneNumber,
  optionalPostalCode,
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";

const CUSTOMER_PROFILE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "suffix",
  "occupation",
  "phoneNumber",
  "contactEmail",
  "facebookName",
  "addressLine1",
  "barangay",
  "cityMunicipality",
  "province",
  "region",
  "postalCode",
] as const;
import { HttpError } from "../../utils/httpError";
import { deleteFileByUrl, saveFile } from "../../services/fileStorage.service";
import { detectImageType } from "../../utils/imageType";
import {
  archiveCustomerProfile,
  createCustomerProfileForUser,
  getCustomerById,
  getCustomerProfileByUserId,
  searchCustomers,
  updateCustomerProfileByStaff,
  updateCustomerProfileForUser,
  updateCustomerProfileImage,
  type CustomerProfileOptionalFields,
  type UpdateCustomerProfileInput,
} from "./customer.service";

function parseOptionalProfileFields(
  body: unknown
): CustomerProfileOptionalFields {
  const raw = (body ?? {}) as Record<string, unknown>;

  return {
    middleName: optionalString(raw.middleName, "Middle name", 100),
    suffix: optionalString(raw.suffix, "Suffix", 20),
    occupation: optionalString(raw.occupation, "Occupation", 100),
    phoneNumber: optionalPhoneNumber(raw.phoneNumber, "Phone number"),
    contactEmail: optionalEmail(raw.contactEmail, "Contact email"),
    facebookName: optionalString(raw.facebookName, "Facebook name", 100),
    addressLine1: optionalString(raw.addressLine1, "Address line 1", 200),
    barangay: optionalString(raw.barangay, "Barangay", 100),
    cityMunicipality: optionalString(
      raw.cityMunicipality,
      "City/Municipality",
      100
    ),
    province: optionalString(raw.province, "Province", 100),
    region: optionalString(raw.region, "Region", 100),
    postalCode: optionalPostalCode(raw.postalCode, "Postal code"),
  };
}

function queryParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/*
 * These fields are controlled by DACS and must never be changed through
 * a profile-update endpoint (farmer or staff). Attempting to send them
 * is rejected loudly so frontend mistakes are caught early.
 */
const PROTECTED_PROFILE_FIELDS = [
  "id",
  "customerNumber",
  "userId",
  "firebaseUid",
  "role",
  "status",
  "createdAt",
  "updatedAt",
] as const;

function respondToProtectedFields(
  raw: Record<string, unknown>,
  response: Response
): boolean {
  const attemptedProtectedFields = PROTECTED_PROFILE_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(raw, field)
  );

  if (attemptedProtectedFields.length > 0) {
    response.status(400).json({
      success: false,
      message: "One or more system-managed fields cannot be changed.",
      protectedFields: attemptedProtectedFields,
    });
    return true;
  }

  return false;
}

/*
 * Shared PATCH validation for customer profiles: names may change but
 * never be cleared, everything else follows the optional-field rules.
 */
function parseCustomerProfilePatch(
  raw: Record<string, unknown>
): UpdateCustomerProfileInput {
  rejectUnexpectedFields(raw, CUSTOMER_PROFILE_FIELDS);

  const firstName = optionalString(raw.firstName, "First name", 100);
  if (firstName === null) {
    throw new HttpError(400, "First name cannot be empty.");
  }

  const lastName = optionalString(raw.lastName, "Last name", 100);
  if (lastName === null) {
    throw new HttpError(400, "Last name cannot be empty.");
  }

  return {
    ...parseOptionalProfileFields(raw),
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
  };
}

export async function listCustomers(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const search = queryParam(request.query.search);
    const province = queryParam(request.query.province);
    const region = queryParam(request.query.region);
    const city = queryParam(request.query.city);

    const customers = await searchCustomers({
      search,
      province,
      region,
      city,
      includeArchived: queryParam(request.query.includeArchived) === "true",
    });

    response.json({
      success: true,
      count: customers.length,
      filters: {
        search: search ?? null,
        province: province ?? null,
        region: region ?? null,
        city: city ?? null,
      },
      data: customers,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCustomer(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const customerId = requiredUuid(
      request.params.customerId,
      "The customer ID"
    );

    const profile = await getCustomerById(customerId);

    response.json({
      success: true,
      message: "Customer retrieved successfully.",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyCustomerProfile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const profile = await getCustomerProfileByUserId(dacsUser.id);

    if (!profile) {
      response.status(404).json({
        success: false,
        message: "No customer profile is linked to this DACS account.",
      });
      return;
    }

    response.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function createMyCustomerProfile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, CUSTOMER_PROFILE_FIELDS);

    const firstName = requiredString(raw.firstName, "First name", 100);
    const lastName = requiredString(raw.lastName, "Last name", 100);
    const optionalFields = parseOptionalProfileFields(request.body);

    const profile = await createCustomerProfileForUser(
      dacsUser.id,
      dacsUser.email,
      { ...optionalFields, firstName, lastName },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.status(201).json({
      success: true,
      message: "Customer profile was created successfully.",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMyCustomerProfile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;

    if (respondToProtectedFields(raw, response)) return;

    const input = parseCustomerProfilePatch(raw);

    const profile = await updateCustomerProfileForUser(dacsUser.id, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Customer profile was updated successfully.",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Staff correction of any active customer's record. Same allowlist and
 * protected-field rules as the self-service endpoint; role/credentials
 * are untouchable and the login email is not a profile field.
 */
export async function updateCustomerByStaff(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = request.dacsUser;

    if (!actor) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const customerId = requiredUuid(
      request.params.customerId,
      "The customer ID"
    );

    const raw = (request.body ?? {}) as Record<string, unknown>;

    if (respondToProtectedFields(raw, response)) return;

    const input = parseCustomerProfilePatch(raw);

    const profile = await updateCustomerProfileByStaff(
      actor.id,
      customerId,
      input,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Customer profile was updated successfully.",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadMyProfileImage(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: 'A profile image file is required in the "image" field.',
      });
      return;
    }

    const imageType = detectImageType(file.buffer);

    if (!imageType) {
      response.status(400).json({
        success: false,
        message: "Only JPEG, PNG, and WebP images are allowed.",
      });
      return;
    }

    const filename = `profile-${dacsUser.id}-${Date.now()}.${imageType.extension}`;
    const imageUrl = await saveFile("profile-images", filename, file.buffer);

    let result;
    try {
      result = await updateCustomerProfileImage(dacsUser.id, imageUrl, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
    } catch (error) {
      // The database update failed — don't leave an orphaned file behind.
      await deleteFileByUrl(imageUrl);
      throw error;
    }

    if (result.previousImageUrl && result.previousImageUrl !== imageUrl) {
      await deleteFileByUrl(result.previousImageUrl);
    }

    response.json({
      success: true,
      message: "Profile image was updated successfully.",
      data: result.profile,
    });
  } catch (error) {
    next(error);
  }
}

export async function archiveCustomer(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dacsUser = request.dacsUser;

    if (!dacsUser) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const profile = await archiveCustomerProfile(
      requiredUuid(request.params.customerId, "The customer ID"),
      dacsUser.id,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: `Customer profile ${profile.customerNumber} was archived.`,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
}
