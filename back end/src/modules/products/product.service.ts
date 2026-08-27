import type {
  Prisma,
  ProductCategory,
} from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export interface CreateProductInput {
  productCode: string;
  name: string;
  category: ProductCategory;
  description?: string | null;
  unit?: string | null;
  unitPrice: number;
}

export interface UpdateProductInput {
  productCode?: string;
  name?: string;
  category?: ProductCategory;
  description?: string | null;
  unit?: string | null;
  unitPrice?: number;
  isActive?: boolean;
}

export async function getActiveProducts() {
  return prisma.product.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function getProductById(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new HttpError(404, "Product was not found.");
  }

  return product;
}

export async function createProduct(
  actorUserId: string,
  input: CreateProductInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.product.findUnique({
      where: { productCode: input.productCode },
    });

    if (existing) {
      throw new HttpError(409, "A product with this code already exists.");
    }

    const product = await transaction.product.create({
      data: {
        productCode: input.productCode,
        name: input.name,
        category: input.category,
        description: input.description,
        unit: input.unit,
        unitPrice: input.unitPrice,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PRODUCTS",
      action: "PRODUCT_CREATED",
      description: `Product ${product.productCode} - ${product.name} was created.`,
      recordType: "Product",
      recordId: product.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  });
}

export async function updateProduct(
  actorUserId: string,
  productId: string,
  input: UpdateProductInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.product.findUnique({
      where: { id: productId },
    });

    if (!existing) {
      throw new HttpError(404, "Product was not found.");
    }

    if (input.productCode && input.productCode !== existing.productCode) {
      const duplicate = await transaction.product.findUnique({
        where: { productCode: input.productCode },
      });

      if (duplicate) {
        throw new HttpError(409, "A product with this code already exists.");
      }
    }

    const data: Prisma.ProductUpdateInput = {};
    if (input.productCode !== undefined) data.productCode = input.productCode;
    if (input.name !== undefined) data.name = input.name;
    if (input.category !== undefined) data.category = input.category;
    if (input.description !== undefined) data.description = input.description;
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.unitPrice !== undefined) data.unitPrice = input.unitPrice;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one product field must be supplied.");
    }

    const product = await transaction.product.update({
      where: { id: productId },
      data,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PRODUCTS",
      action: "PRODUCT_UPDATED",
      description: `Product ${product.productCode} - ${product.name} was updated.`,
      recordType: "Product",
      recordId: product.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  });
}

/*
 * Products are deactivated instead of deleted so historical OrderItems
 * can keep referencing them.
 */
export async function deactivateProduct(
  actorUserId: string,
  productId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.product.findUnique({
      where: { id: productId },
    });

    if (!existing) {
      throw new HttpError(404, "Product was not found.");
    }

    const product = await transaction.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PRODUCTS",
      action: "PRODUCT_DEACTIVATED",
      description: `Product ${product.productCode} - ${product.name} was deactivated.`,
      recordType: "Product",
      recordId: product.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return product;
  });
}
