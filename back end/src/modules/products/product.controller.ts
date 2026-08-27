import type { NextFunction, Request, Response } from "express";

import type { ProductCategory } from "../../../generated/prisma/client";

import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  createProduct,
  deactivateProduct,
  getActiveProducts,
  getProductById,
  updateProduct,
  type UpdateProductInput,
} from "./product.service";

const VALID_CATEGORIES = ["PARENT_STOCK", "F1", "VETERINARY_PRODUCT"] as const;

const PRODUCT_FIELDS = [
  "productCode",
  "name",
  "category",
  "description",
  "unit",
  "unitPrice",
  "isActive",
] as const;

export async function listProducts(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const products = await getActiveProducts();

    response.json({
      success: true,
      count: products.length,
      data: products,
    });
  } catch (error) {
    next(error);
  }
}

export async function getIndividualProduct(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const productId = requiredUuid(request.params.productId, "The product ID");
    const product = await getProductById(productId);

    response.json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
}

export async function createNewProduct(
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

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, PRODUCT_FIELDS);

    const productCode = requiredString(raw.productCode, "Product code", 50);
    const name = requiredString(raw.name, "Product name", 150);

    if (
      typeof raw.category !== "string" ||
      !VALID_CATEGORIES.includes(raw.category as ProductCategory)
    ) {
      response.status(400).json({
        success: false,
        message: "A valid product category is required.",
      });
      return;
    }

    if (
      typeof raw.unitPrice !== "number" ||
      !Number.isFinite(raw.unitPrice) ||
      raw.unitPrice < 0
    ) {
      response.status(400).json({
        success: false,
        message: "Unit price must be a valid non-negative number.",
      });
      return;
    }

    const product = await createProduct(
      actor.id,
      {
        productCode: productCode.toUpperCase(),
        name,
        category: raw.category as ProductCategory,
        description: optionalString(raw.description, "Description", 500),
        unit: optionalString(raw.unit, "Unit", 50),
        unitPrice: raw.unitPrice,
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.status(201).json({
      success: true,
      message: "Product was created successfully.",
      data: product,
    });
  } catch (error) {
    next(error);
  }
}

export async function editProduct(
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

    const productId = requiredUuid(request.params.productId, "The product ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, PRODUCT_FIELDS);

    const input: UpdateProductInput = {};

    if (raw.productCode !== undefined) {
      const productCode = optionalString(raw.productCode, "Product code", 50);
      if (!productCode) {
        response.status(400).json({
          success: false,
          message: "Product code cannot be empty.",
        });
        return;
      }
      input.productCode = productCode.toUpperCase();
    }

    if (raw.name !== undefined) {
      const name = optionalString(raw.name, "Product name", 150);
      if (!name) {
        response.status(400).json({
          success: false,
          message: "Product name cannot be empty.",
        });
        return;
      }
      input.name = name;
    }

    if (raw.category !== undefined) {
      if (
        typeof raw.category !== "string" ||
        !VALID_CATEGORIES.includes(raw.category as ProductCategory)
      ) {
        response.status(400).json({
          success: false,
          message: "The product category is not valid.",
        });
        return;
      }
      input.category = raw.category as ProductCategory;
    }

    if (raw.unitPrice !== undefined) {
      if (
        typeof raw.unitPrice !== "number" ||
        !Number.isFinite(raw.unitPrice) ||
        raw.unitPrice < 0
      ) {
        response.status(400).json({
          success: false,
          message: "Unit price must be a valid non-negative number.",
        });
        return;
      }
      input.unitPrice = raw.unitPrice;
    }

    if (raw.description !== undefined) {
      input.description = optionalString(raw.description, "Description", 500);
    }

    if (raw.unit !== undefined) {
      input.unit = optionalString(raw.unit, "Unit", 50);
    }

    if (raw.isActive !== undefined) {
      if (typeof raw.isActive !== "boolean") {
        response.status(400).json({
          success: false,
          message: "isActive must be true or false.",
        });
        return;
      }
      input.isActive = raw.isActive;
    }

    const product = await updateProduct(actor.id, productId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Product was updated successfully.",
      data: product,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeProduct(
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

    const productId = requiredUuid(request.params.productId, "The product ID");

    const product = await deactivateProduct(actor.id, productId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Product was deactivated successfully.",
      data: product,
    });
  } catch (error) {
    next(error);
  }
}
