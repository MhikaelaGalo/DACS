import type { NextFunction, Request, Response } from "express";

import type {
  FulfillmentMethod,
  OrderType,
} from "../../../generated/prisma/client";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredUuid,
} from "../../utils/validation";
import {
  changeOrderStatus,
  createOrderForUser,
  getAllOrders,
  getOrderById,
  getOrderForUser,
  getOrdersForUser,
  setOrderPaymentSchedule,
  updateOrderDetails,
  type CreateOrderItemInput,
  type StaffOrderStatus,
  type UpdateOrderInput,
  type UpdateOrderItemInput,
} from "./order.service";

const VALID_ORDER_TYPES = [
  "PARENT_STOCK",
  "F1",
  "VETERINARY_PRODUCT",
  "SEMINAR",
] as const;

const VALID_FULFILLMENT_METHODS = [
  "PICKUP",
  "LBC_BRANCH",
  "AIRPORT",
  "DELIVERY",
] as const;

const VALID_STAFF_STATUSES = [
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

/*
 * Totals, prices, and status are always calculated by the backend, so
 * none of them appear in the allowlist.
 */
const ORDER_FIELDS = [
  "orderType",
  "dateNeeded",
  "hatchDate",
  "receiverName",
  "receiverFacebook",
  "receiverContact",
  "fulfillmentMethod",
  "deliveryAddress",
  "airportLocation",
  "pickupBranch",
  "instructions",
  "items",
] as const;

const ORDER_ITEM_FIELDS = ["productId", "seminarModuleId", "quantity"] as const;

/*
 * A generous per-line-item ceiling. Real poultry orders never approach
 * this, but a positive-integer-only check let a malformed/hostile request
 * send a quantity large enough to overflow the Decimal(12,2) money
 * columns, which surfaced as an unhandled 500 instead of a clean 400.
 * The authoritative total is additionally bounded in order.service.
 */
const MAX_ORDER_QUANTITY = 1_000_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD format.`, field);
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is not a valid date.`, field);
  }

  return date;
}

/*
 * Item bodies get their own allowlist so a price-injection attempt
 * (sending unitPrice inside an item) is rejected loudly.
 */
function parseOrderItems(value: unknown): CreateOrderItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "At least one order item is required.", "items");
  }

  const items: CreateOrderItemInput[] = [];

  for (const rawItem of value) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      throw new HttpError(400, "Every order item must be a valid object.", "items");
    }

    const item = rawItem as Record<string, unknown>;

    const unexpectedField = Object.keys(item).find(
      (field) => !ORDER_ITEM_FIELDS.includes(field as never)
    );

    if (unexpectedField) {
      throw new HttpError(
        400,
        `The order-item field "${unexpectedField}" is not allowed.`,
        unexpectedField
      );
    }

    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_ORDER_QUANTITY
    ) {
      throw new HttpError(
        400,
        `Order-item quantity must be a whole number from 1 to ${MAX_ORDER_QUANTITY}.`,
        "quantity"
      );
    }

    // Exactly one target per line: a catalog product OR a seminar module.
    const hasProduct = item.productId !== undefined;
    const hasSeminarModule = item.seminarModuleId !== undefined;

    if (hasProduct === hasSeminarModule) {
      throw new HttpError(
        400,
        "Every order item must reference exactly one product or one seminar module.",
        "items"
      );
    }

    items.push(
      hasProduct
        ? {
            productId: requiredUuid(
              item.productId,
              "Every order item's product ID"
            ),
            quantity: item.quantity,
          }
        : {
            seminarModuleId: requiredUuid(
              item.seminarModuleId,
              "Every order item's seminar module ID"
            ),
            quantity: item.quantity,
          }
    );
  }

  return items;
}

export async function submitOrder(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = request.dacsUser;

    if (!user) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ORDER_FIELDS);

    if (
      typeof raw.orderType !== "string" ||
      !VALID_ORDER_TYPES.includes(raw.orderType as OrderType)
    ) {
      response.status(400).json({
        success: false,
        message: "A valid order type is required.",
      });
      return;
    }

    const items = parseOrderItems(raw.items);

    let fulfillmentMethod: FulfillmentMethod | null = null;

    if (raw.fulfillmentMethod !== undefined && raw.fulfillmentMethod !== null) {
      if (
        typeof raw.fulfillmentMethod !== "string" ||
        !VALID_FULFILLMENT_METHODS.includes(
          raw.fulfillmentMethod as FulfillmentMethod
        )
      ) {
        response.status(400).json({
          success: false,
          message: "The fulfillment method is not valid.",
        });
        return;
      }

      fulfillmentMethod = raw.fulfillmentMethod as FulfillmentMethod;
    }

    const deliveryAddress =
      optionalString(raw.deliveryAddress, "Delivery address", 255) ?? null;
    const airportLocation =
      optionalString(raw.airportLocation, "Airport location", 150) ?? null;
    const pickupBranch =
      optionalString(raw.pickupBranch, "Pickup branch", 150) ?? null;

    // The chosen fulfillment method dictates which detail is required.
    if (fulfillmentMethod === "DELIVERY" && !deliveryAddress) {
      response.status(400).json({
        success: false,
        message: "A delivery address is required for delivery orders.",
      });
      return;
    }

    if (fulfillmentMethod === "AIRPORT" && !airportLocation) {
      response.status(400).json({
        success: false,
        message: "An airport location is required for airport orders.",
      });
      return;
    }

    if (fulfillmentMethod === "LBC_BRANCH" && !pickupBranch) {
      response.status(400).json({
        success: false,
        message: "An LBC branch is required for LBC orders.",
      });
      return;
    }

    const order = await createOrderForUser(
      user.id,
      {
        orderType: raw.orderType as OrderType,
        dateNeeded: optionalDate(raw.dateNeeded, "dateNeeded"),
        hatchDate: optionalDate(raw.hatchDate, "hatchDate"),
        receiverName:
          optionalString(raw.receiverName, "Receiver name", 150) ?? null,
        receiverFacebook:
          optionalString(raw.receiverFacebook, "Receiver Facebook", 150) ?? null,
        receiverContact:
          optionalString(raw.receiverContact, "Receiver contact", 50) ?? null,
        fulfillmentMethod,
        deliveryAddress,
        airportLocation,
        pickupBranch,
        instructions:
          optionalString(raw.instructions, "Instructions", 1000) ?? null,
        items,
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.status(201).json({
      success: true,
      message: "Order was submitted successfully.",
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyOrders(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = request.dacsUser;

    if (!user) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const result = await getOrdersForUser(user.id);

    if (!result) {
      response.status(404).json({
        success: false,
        message: "No active customer profile is linked to this account.",
      });
      return;
    }

    response.json({
      success: true,
      customerNumber: result.customerNumber,
      count: result.orders.length,
      data: result.orders,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyOrder(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = request.dacsUser;

    if (!user) {
      response.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
      return;
    }

    const orderId = requiredUuid(request.params.orderId, "The order ID");
    const order = await getOrderForUser(user.id, orderId);

    if (!order) {
      response.status(404).json({
        success: false,
        message: "Order was not found or does not belong to this account.",
      });
      return;
    }

    response.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

export async function listOrders(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orders = await getAllOrders();

    response.json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
}

export async function getIndividualOrder(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orderId = requiredUuid(request.params.orderId, "The order ID");
    const order = await getOrderById(orderId);

    if (!order) {
      response.status(404).json({
        success: false,
        message: "Order was not found.",
      });
      return;
    }

    response.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateOrderStatus(
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

    const orderId = requiredUuid(request.params.orderId, "The order ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["status", "notes"]);

    if (
      typeof raw.status !== "string" ||
      !VALID_STAFF_STATUSES.includes(raw.status as StaffOrderStatus)
    ) {
      response.status(400).json({
        success: false,
        message: "The requested order status is not valid for this endpoint.",
      });
      return;
    }

    const order = await changeOrderStatus(
      actor.id,
      orderId,
      raw.status as StaffOrderStatus,
      optionalString(raw.notes, "Notes", 500) ?? null,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Order status was updated successfully.",
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

const ORDER_EDIT_FIELDS = [
  "dateNeeded",
  "hatchDate",
  "receiverName",
  "receiverFacebook",
  "receiverContact",
  "fulfillmentMethod",
  "deliveryAddress",
  "airportLocation",
  "pickupBranch",
  "instructions",
  "feeTotal",
  "items",
] as const;

const ORDER_EDIT_ITEM_FIELDS = ["productId", "quantity", "unitPrice"] as const;

const MAX_MONEY_VALUE = 9_999_999.99;

/*
 * PATCH semantics for date fields: an absent key leaves the stored date
 * unchanged, null/"" clears it, and a YYYY-MM-DD string sets it.
 */
function patchDate(
  raw: Record<string, unknown>,
  field: string
): Date | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(raw, field)) return undefined;
  return optionalDate(raw[field], field);
}

function requireMoney(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_MONEY_VALUE
  ) {
    throw new HttpError(
      400,
      `${field} must be a number between 0 and ${MAX_MONEY_VALUE}.`,
      field
    );
  }
  return value;
}

function parseOrderEditItems(value: unknown): UpdateOrderItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "At least one order item is required.", "items");
  }

  const items: UpdateOrderItemInput[] = [];

  for (const rawItem of value) {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      throw new HttpError(400, "Every order item must be a valid object.", "items");
    }

    const item = rawItem as Record<string, unknown>;

    const unexpectedField = Object.keys(item).find(
      (field) => !ORDER_EDIT_ITEM_FIELDS.includes(field as never)
    );

    if (unexpectedField) {
      throw new HttpError(
        400,
        `The order-item field "${unexpectedField}" is not allowed.`,
        unexpectedField
      );
    }

    if (
      typeof item.quantity !== "number" ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > MAX_ORDER_QUANTITY
    ) {
      throw new HttpError(
        400,
        `Order-item quantity must be a whole number from 1 to ${MAX_ORDER_QUANTITY}.`,
        "quantity"
      );
    }

    items.push({
      productId: requiredUuid(item.productId, "Every order item's product ID"),
      quantity: item.quantity,
      ...(item.unitPrice !== undefined
        ? { unitPrice: requireMoney(item.unitPrice, "Order-item unit price") }
        : {}),
    });
  }

  return items;
}

/*
 * Staff quotation editing (the admin "Edit Order" card): items with
 * quantities and agreed prices, logistics details, and the shipping
 * fee. Status, totals, order number, and ownership are never accepted
 * from the client — totals are recalculated by the service.
 */
export async function editOrder(
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

    const orderId = requiredUuid(request.params.orderId, "The order ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ORDER_EDIT_FIELDS);

    const input: UpdateOrderInput = {};

    const dateNeeded = patchDate(raw, "dateNeeded");
    if (dateNeeded !== undefined) input.dateNeeded = dateNeeded;

    const hatchDate = patchDate(raw, "hatchDate");
    if (hatchDate !== undefined) input.hatchDate = hatchDate;

    if (raw.receiverName !== undefined) {
      input.receiverName =
        optionalString(raw.receiverName, "Receiver name", 150) ?? null;
    }

    if (raw.receiverFacebook !== undefined) {
      input.receiverFacebook =
        optionalString(raw.receiverFacebook, "Receiver Facebook", 150) ?? null;
    }

    if (raw.receiverContact !== undefined) {
      input.receiverContact =
        optionalString(raw.receiverContact, "Receiver contact", 50) ?? null;
    }

    if (raw.fulfillmentMethod !== undefined) {
      if (raw.fulfillmentMethod === null) {
        input.fulfillmentMethod = null;
      } else if (
        typeof raw.fulfillmentMethod !== "string" ||
        !VALID_FULFILLMENT_METHODS.includes(
          raw.fulfillmentMethod as FulfillmentMethod
        )
      ) {
        throw new HttpError(400, "The fulfillment method is not valid.");
      } else {
        input.fulfillmentMethod = raw.fulfillmentMethod as FulfillmentMethod;
      }
    }

    if (raw.deliveryAddress !== undefined) {
      input.deliveryAddress =
        optionalString(raw.deliveryAddress, "Delivery address", 255) ?? null;
    }

    if (raw.airportLocation !== undefined) {
      input.airportLocation =
        optionalString(raw.airportLocation, "Airport location", 150) ?? null;
    }

    if (raw.pickupBranch !== undefined) {
      input.pickupBranch =
        optionalString(raw.pickupBranch, "Pickup branch", 150) ?? null;
    }

    if (raw.instructions !== undefined) {
      input.instructions =
        optionalString(raw.instructions, "Instructions", 1000) ?? null;
    }

    if (raw.feeTotal !== undefined) {
      input.feeTotal = requireMoney(raw.feeTotal, "The shipping fee");
    }

    if (raw.items !== undefined) {
      input.items = parseOrderEditItems(raw.items);
    }

    const order = await updateOrderDetails(actor.id, orderId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Order was updated successfully.",
      data: order,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateOrderPaymentSchedule(
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

    const orderId = requiredUuid(request.params.orderId, "The order ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, [
      "depositPercent",
      "depositDueDate",
      "balanceDueDate",
    ]);

    if (
      typeof raw.depositPercent !== "number" ||
      !Number.isInteger(raw.depositPercent) ||
      raw.depositPercent < 1 ||
      raw.depositPercent > 99
    ) {
      response.status(400).json({
        success: false,
        message: "The deposit percent must be a whole number from 1 to 99.",
      });
      return;
    }

    const depositDueDate = optionalDate(raw.depositDueDate, "depositDueDate");
    const balanceDueDate = optionalDate(raw.balanceDueDate, "balanceDueDate");

    if (!depositDueDate || !balanceDueDate) {
      response.status(400).json({
        success: false,
        message: "Both the deposit and balance due dates are required.",
      });
      return;
    }

    const order = await setOrderPaymentSchedule(
      actor.id,
      orderId,
      {
        depositPercent: raw.depositPercent,
        depositDueDate,
        balanceDueDate,
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Order payment schedule was saved successfully.",
      data: order,
    });
  } catch (error) {
    next(error);
  }
}
