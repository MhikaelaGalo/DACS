import type { NextFunction, Request, Response } from "express";

import { deleteFileByUrl, saveFile } from "../../services/fileStorage.service";
import { HttpError } from "../../utils/httpError";
import { detectImageType } from "../../utils/imageType";
import {
  optionalBoolean,
  optionalPostalCode,
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";

const FARM_INPUT_FIELDS = [
  "farmName",
  "addressLine1",
  "barangay",
  "cityMunicipality",
  "province",
  "region",
  "postalCode",
  "isPrimary",
] as const;
import {
  archiveFarmForUser,
  createFarmForUser,
  getFarmsForUser,
  updateFarmByStaff,
  updateFarmForUser,
  updateFarmLogoForUser,
  type FarmInput,
} from "./farm.service";

/*
 * Staff correction of a customer's farm (registered under
 * /api/customers/:customerId/farms/:farmId). Same field allowlist and
 * validation as the farmer's own update endpoint.
 */
export async function updateCustomerFarmByStaff(
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
    const farmId = requiredUuid(request.params.farmId, "The farm ID");

    const input = parseFarmInput(request.body);

    const farm = await updateFarmByStaff(actor.id, customerId, farmId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Farm was updated successfully.",
      data: farm,
    });
  } catch (error) {
    next(error);
  }
}

function parseFarmInput(body: unknown): FarmInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  rejectUnexpectedFields(raw, FARM_INPUT_FIELDS);

  const farmName = optionalString(raw.farmName, "Farm name", 150);
  if (farmName === null) {
    throw new HttpError(400, "Farm name cannot be empty.");
  }

  return {
    farmName,
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
    isPrimary: optionalBoolean(raw.isPrimary, "isPrimary"),
  };
}

export async function listMyFarms(
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

    const result = await getFarmsForUser(dacsUser.id);

    response.json({
      success: true,
      customerNumber: result.customerNumber,
      count: result.farms.length,
      data: result.farms,
    });
  } catch (error) {
    next(error);
  }
}

export async function createMyFarm(
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
    const farmName = requiredString(raw.farmName, "Farm name", 150);
    const input = parseFarmInput(request.body);

    const farm = await createFarmForUser(
      dacsUser.id,
      { ...input, farmName },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.status(201).json({
      success: true,
      message: "Farm was created successfully.",
      data: farm,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateMyFarm(
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

    const input = parseFarmInput(request.body);

    const farm = await updateFarmForUser(
      dacsUser.id,
      requiredUuid(request.params.farmId, "The farm ID"),
      input,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Farm was updated successfully.",
      data: farm,
    });
  } catch (error) {
    next(error);
  }
}

export async function uploadMyFarmLogo(
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

    const farmId = requiredUuid(request.params.farmId, "The farm ID");
    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: 'A farm logo image is required in the "image" field.',
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

    const filename = `farm-logo-${farmId}-${Date.now()}.${imageType.extension}`;
    const logoUrl = await saveFile("farm-logos", filename, file.buffer);

    let result;
    try {
      result = await updateFarmLogoForUser(dacsUser.id, farmId, logoUrl, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
    } catch (error) {
      // Ownership check or database update failed — remove the orphan file.
      await deleteFileByUrl(logoUrl);
      throw error;
    }

    if (result.previousLogoUrl && result.previousLogoUrl !== logoUrl) {
      await deleteFileByUrl(result.previousLogoUrl);
    }

    response.json({
      success: true,
      message: "Farm logo was updated successfully.",
      data: result.farm,
    });
  } catch (error) {
    next(error);
  }
}

export async function archiveMyFarm(
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

    const farmId = requiredUuid(request.params.farmId, "The farm ID");

    await archiveFarmForUser(dacsUser.id, farmId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Farm was archived successfully.",
    });
  } catch (error) {
    next(error);
  }
}
