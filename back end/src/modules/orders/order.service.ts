import { Prisma } from "../../../generated/prisma/client";
import type {
  FulfillmentMethod,
  OrderStatus,
  OrderType,
} from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";
import { startBreederMonitoringForReleasedOrder } from "../breeders/breeder.service";
import { notifyStaff } from "../notifications/notification.service";
import {
  countCompletedRequiredModules,
  REQUIRED_MODULE_NUMBERS,
  SEMINAR_OWNED_ORDER_STATUSES,
} from "../seminars/seminar.service";

/*
 * Advisory-lock key for order-number generation (the customers module
 * uses 43010001 for DAPG numbers). Exported for the historical importer,
 * which must serialize against the same sequence when a legacy row
 * arrives without an order number.
 */
export const ORDER_NUMBER_LOCK_KEY = 43010002;

/*
 * Order numbers follow the client's quotation format: OQ-VET-2026-001.
 * The sequence is scoped per type per year, so each code restarts at
 * 001 every January.
 */
export const ORDER_TYPE_CODES: Record<OrderType, string> = {
  VETERINARY_PRODUCT: "VET",
  F1: "F1",
  PARENT_STOCK: "PS",
  SEMINAR: "SEM",
};

/*
 * The money columns are Decimal(12,2); a computed total above this would
 * overflow at insert time and surface as an unhandled 500. We reject it
 * as a clean 400 first. This is the authoritative overflow guard — the
 * controller's per-item quantity cap is the first line of defense.
 */
const MAX_ORDER_TOTAL = new Prisma.Decimal("9999999999.99");

function assertTotalWithinBounds(total: Prisma.Decimal): void {
  if (total.greaterThan(MAX_ORDER_TOTAL)) {
    throw new HttpError(
      400,
      "The order total exceeds the maximum amount DACS can record. Please reduce the quantities."
    );
  }
}

/*
 * Statuses staff may set through PATCH /:orderId/status. The
 * payment-driven transitions (PAYMENT_SUBMITTED, PAYMENT_VERIFIED) are
 * owned by Requirement 5's payment endpoints, not this one.
 */
export type StaffOrderStatus =
  | "APPROVED"
  | "REJECTED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

/*
 * One checkout line: a catalog product (product orders) or one seminar
 * module (SEMINAR orders). The controller guarantees exactly one of the
 * two IDs is present per item.
 */
export interface CreateOrderItemInput {
  productId?: string;
  seminarModuleId?: string;
  quantity: number;
}

export interface CreateOrderInput {
  orderType: OrderType;
  dateNeeded?: Date | null;
  hatchDate?: Date | null;
  receiverName?: string | null;
  receiverFacebook?: string | null;
  receiverContact?: string | null;
  fulfillmentMethod?: FulfillmentMethod | null;
  deliveryAddress?: string | null;
  airportLocation?: string | null;
  pickupBranch?: string | null;
  instructions?: string | null;
  items: CreateOrderItemInput[];
}

const ORDER_INCLUDE = {
  items: true,
  statusHistory: {
    orderBy: { createdAt: "asc" as const },
  },
};

async function getActiveProfileForUser(
  client: Prisma.TransactionClient,
  userId: string
) {
  return client.customerProfile.findFirst({
    where: { userId, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
}

export async function createOrderForUser(
  userId: string,
  input: CreateOrderInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const customerProfile = await getActiveProfileForUser(transaction, userId);

    if (!customerProfile) {
      throw new HttpError(
        404,
        "No active customer profile is linked to this account."
      );
    }

    /*
     * Parent Stock requires completing Seminar Modules 1-3 (the real
     * Requirement 6 check — this replaced the temporary unconditional
     * block that guarded the rule before seminars existed).
     */
    if (input.orderType === "PARENT_STOCK") {
      const completedRequiredModules = await countCompletedRequiredModules(
        transaction,
        customerProfile.id
      );

      if (completedRequiredModules !== REQUIRED_MODULE_NUMBERS.length) {
        throw new HttpError(
          409,
          "Parent Stock ordering requires completing Seminar Modules 1, 2, and 3 first."
        );
      }
    }

    /*
     * Serialize order-number generation so two orders submitted at the
     * same moment cannot receive the same number.
     */
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK_KEY})`;

    /*
     * The next sequence is MAX of the numeric tail, not a text sort:
     * the 3-digit padding overflows naturally to OQ-VET-2026-1000,
     * where descending text order would pick the wrong "latest".
     * Legacy ORD-XXXXXX numbers never match the prefix, so they are
     * simply left behind by the new scheme.
     */
    const numberPrefix = `OQ-${ORDER_TYPE_CODES[input.orderType]}-${new Date().getUTCFullYear()}-`;

    const [latestRow] = await transaction.$queryRaw<[{ max: number | null }]>`
      SELECT MAX(CAST(SUBSTRING(order_number FROM ${`${numberPrefix.length + 1}`}::INTEGER) AS INTEGER)) AS max
      FROM orders
      WHERE order_number LIKE ${`${numberPrefix}%`}
    `;

    const nextNumber = (latestRow?.max ?? 0) + 1;

    const orderNumber = `${numberPrefix}${String(nextNumber).padStart(3, "0")}`;

    /*
     * Prices always come from backend records (products table, or the
     * seminar module's own price), never from the request body: load
     * every requested record and snapshot it.
     */
    let subtotal = new Prisma.Decimal(0);
    const preparedItems: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] =
      [];

    if (input.orderType === "SEMINAR") {
      /*
       * Seminar orders sell module ACCESS: one item per module, always
       * quantity 1 (access is per customer, never stacked), only for
       * published paid modules. Duplicate protection below relies on
       * the order-number advisory lock already held by this transaction
       * — concurrent checkouts of the same module serialize on it, so
       * the second one sees the first one's committed order.
       */
      const moduleIds = input.items.map((item) => item.seminarModuleId);

      if (moduleIds.some((moduleId) => !moduleId)) {
        throw new HttpError(
          400,
          "Every item of a seminar order must reference a seminar module."
        );
      }

      if (new Set(moduleIds).size !== moduleIds.length) {
        throw new HttpError(
          400,
          "The same seminar module cannot appear in the order more than once."
        );
      }

      if (input.items.some((item) => item.quantity !== 1)) {
        throw new HttpError(
          400,
          "Seminar module access is one per customer — the quantity must be 1."
        );
      }

      const modules = await transaction.seminarModule.findMany({
        where: {
          id: { in: moduleIds as string[] },
          isPublished: true,
          archivedAt: null,
        },
      });

      if (modules.length !== moduleIds.length) {
        throw new HttpError(
          400,
          "One or more seminar modules do not exist or are not available."
        );
      }

      for (const module of modules) {
        if (module.price.lte(0)) {
          throw new HttpError(
            400,
            `${module.title} is a free module and does not need to be purchased.`
          );
        }
      }

      /*
       * One live purchase per module per customer: an order that is not
       * REJECTED/CANCELLED — whether still awaiting approval/payment or
       * already verified — blocks buying the same module again.
       */
      const blockingItem = await transaction.orderItem.findFirst({
        where: {
          itemType: "SEMINAR_MODULE",
          seminarModuleId: { in: moduleIds as string[] },
          order: {
            customerProfileId: customerProfile.id,
            status: { notIn: ["REJECTED", "CANCELLED"] },
          },
        },
        select: {
          productNameSnapshot: true,
          order: { select: { status: true, orderNumber: true } },
        },
      });

      if (blockingItem) {
        const alreadyOwned = SEMINAR_OWNED_ORDER_STATUSES.includes(
          blockingItem.order.status
        );
        throw new HttpError(
          409,
          alreadyOwned
            ? `You already own ${blockingItem.productNameSnapshot} — it does not need to be purchased again.`
            : `You already have order ${blockingItem.order.orderNumber} for ${blockingItem.productNameSnapshot} awaiting payment verification.`
        );
      }

      for (const module of modules) {
        subtotal = subtotal.add(module.price);

        preparedItems.push({
          itemType: "SEMINAR_MODULE",
          seminarModuleId: module.id,
          // Same snapshot columns as products: what was sold, at the
          // price in force at checkout. Later price edits never change
          // this order.
          productCodeSnapshot: `SEM-M${module.moduleNumber}`,
          productNameSnapshot: module.title,
          unitPriceSnapshot: module.price,
          quantity: 1,
          lineTotal: module.price,
        });
      }
    } else {
      const productIds = [
        ...new Set(input.items.map((item) => item.productId)),
      ];

      if (productIds.some((productId) => !productId)) {
        throw new HttpError(
          400,
          "Seminar modules can only be purchased through a seminar order."
        );
      }

      const products = await transaction.product.findMany({
        where: { id: { in: productIds as string[] }, isActive: true },
      });

      if (products.length !== productIds.length) {
        throw new HttpError(
          400,
          "One or more products do not exist or are inactive."
        );
      }

      const productMap = new Map(
        products.map((product) => [product.id, product])
      );

      for (const requestedItem of input.items) {
        const product = productMap.get(requestedItem.productId ?? "");

        if (!product) {
          throw new HttpError(
            400,
            "One or more products do not exist or are inactive."
          );
        }

        // An F1 order cannot contain a veterinary product, and so on.
        // (Parent Stock components — female / male / additional male per
        // breed line — are separate PARENT_STOCK products, so a PS order
        // simply carries one item per priced component.)
        if (product.category !== input.orderType) {
          throw new HttpError(
            400,
            "Every product in the order must match the selected order type."
          );
        }

        const lineTotal = product.unitPrice.mul(requestedItem.quantity);
        subtotal = subtotal.add(lineTotal);

        preparedItems.push({
          productId: product.id,
          productCodeSnapshot: product.productCode,
          productNameSnapshot: product.name,
          unitPriceSnapshot: product.unitPrice,
          quantity: requestedItem.quantity,
          lineTotal,
        });
      }
    }

    // Delivery/service fees arrive with Requirement 5's payment rules.
    const feeTotal = new Prisma.Decimal(0);
    const totalAmount = subtotal.add(feeTotal);

    assertTotalWithinBounds(totalAmount);

    const order = await transaction.order.create({
      data: {
        orderNumber,
        customerProfileId: customerProfile.id,
        orderType: input.orderType,
        status: "PENDING",
        // Every order carries its own independent 14-day payment window,
        // measured from checkout. The stored value (not a re-computation
        // from createdAt) is what the auto-cancel sweep enforces.
        paymentDeadlineAt: new Date(
          Date.now() + PAYMENT_PROOF_DEADLINE_DAYS * 24 * 60 * 60 * 1000
        ),
        dateNeeded: input.dateNeeded ?? null,
        hatchDate: input.hatchDate ?? null,
        receiverName: input.receiverName ?? null,
        receiverFacebook: input.receiverFacebook ?? null,
        receiverContact: input.receiverContact ?? null,
        fulfillmentMethod: input.fulfillmentMethod ?? null,
        deliveryAddress: input.deliveryAddress ?? null,
        airportLocation: input.airportLocation ?? null,
        pickupBranch: input.pickupBranch ?? null,
        instructions: input.instructions ?? null,
        subtotal,
        feeTotal,
        totalAmount,
        items: { create: preparedItems },
        statusHistory: {
          create: {
            changedByUserId: userId,
            fromStatus: null,
            toStatus: "PENDING",
            notes: "Order submitted.",
          },
        },
      },
      include: ORDER_INCLUDE,
    });

    await recordActivity(transaction, {
      userId,
      module: "ORDERS",
      action: "ORDER_SUBMITTED",
      description: `Order ${order.orderNumber} was submitted.`,
      recordType: "Order",
      recordId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        itemCount: order.items.length,
        totalAmount: order.totalAmount.toString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await notifyStaff(transaction, userId, {
      type: "NEW_ORDER",
      title: "New order submitted",
      message: `${customerProfile.customerNumber} submitted order ${order.orderNumber} (${order.orderType}, ₱${order.totalAmount.toFixed(2)}).`,
      recordType: "Order",
      recordId: order.id,
    });

    return order;
  });
}

/*
 * Checkout policy: customers have this many days to submit a proof of
 * payment (in the app, or by emailing it so staff can follow up) before
 * an unpaid order is released. Mirrored in the customer checkout notice.
 */
export const PAYMENT_PROOF_DEADLINE_DAYS = 14;

const AUTO_CANCEL_NOTE = `Automatically cancelled: no proof of payment was received within ${PAYMENT_PROOF_DEADLINE_DAYS} days of checkout.`;

/*
 * Auto-cancellation sweep over each order's STORED paymentDeadlineAt.
 * It runs from two places: the interval scheduler in order.scheduler.ts
 * (so deadlines are enforced even when nobody opens the website) and
 * lazily before every order read (so lists never show an order the
 * scheduler would cancel within the hour). Historical imports
 * (paymentDeadlineAt NULL by design) are never touched, and any payment
 * row — staff-recorded from an emailed proof, or a legacy in-app upload,
 * even one still awaiting verification — protects the order. Each
 * cancellation re-checks its order inside its own transaction, so a
 * payment recording or staff action racing the sweep wins cleanly.
 */
export async function cancelOverdueUnpaidOrders(): Promise<number> {
  const now = new Date();

  // Fallback for LIVE rows that somehow lack a stored deadline (the
  // migration backfilled all of them, so this is belt-and-braces).
  const legacyCutoff = new Date(
    now.getTime() - PAYMENT_PROOF_DEADLINE_DAYS * 24 * 60 * 60 * 1000
  );

  const staleOrders = await prisma.order.findMany({
    where: {
      source: "LIVE",
      status: { in: ["PENDING", "APPROVED"] },
      payments: { none: {} },
      OR: [
        { paymentDeadlineAt: { lte: now } },
        { paymentDeadlineAt: null, createdAt: { lt: legacyCutoff } },
      ],
    },
    select: { id: true },
  });

  let cancelled = 0;

  for (const stale of staleOrders) {
    await prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { id: stale.id },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          payments: { take: 1, select: { id: true } },
          customerProfile: {
            select: { customerNumber: true, firstName: true, lastName: true },
          },
        },
      });
      if (
        !order ||
        (order.status !== "PENDING" && order.status !== "APPROVED") ||
        order.payments.length > 0
      ) {
        return;
      }

      await transaction.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });

      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          changedByUserId: null,
          fromStatus: order.status,
          toStatus: "CANCELLED",
          notes: AUTO_CANCEL_NOTE,
        },
      });

      await recordActivity(transaction, {
        userId: null,
        module: "ORDERS",
        action: "ORDER_AUTO_CANCELLED",
        description: `Order ${order.orderNumber} was cancelled automatically: no proof of payment within ${PAYMENT_PROOF_DEADLINE_DAYS} days.`,
        recordType: "Order",
        recordId: order.id,
        metadata: {
          orderNumber: order.orderNumber,
          previousStatus: order.status,
          deadlineDays: PAYMENT_PROOF_DEADLINE_DAYS,
        },
      });

      const customerName = [
        order.customerProfile.firstName,
        order.customerProfile.lastName,
      ]
        .filter(Boolean)
        .join(" ");

      await notifyStaff(transaction, null, {
        type: "ORDER_AUTO_CANCELLED",
        title: "Order auto-cancelled — no payment received",
        message: `Order ${order.orderNumber} for ${customerName} (${order.customerProfile.customerNumber}) was automatically cancelled because no payment was recorded within ${PAYMENT_PROOF_DEADLINE_DAYS} days of checkout.`,
        recordType: "Order",
        recordId: order.id,
      });

      cancelled += 1;
    });
  }

  return cancelled;
}

export async function getOrdersForUser(userId: string) {
  await cancelOverdueUnpaidOrders();
  const customerProfile = await getActiveProfileForUser(prisma, userId);

  if (!customerProfile) {
    return null;
  }

  const orders = await prisma.order.findMany({
    where: { customerProfileId: customerProfile.id },
    include: ORDER_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  return {
    customerNumber: customerProfile.customerNumber,
    orders,
  };
}

/*
 * Ownership is enforced by the combined id + customerProfileId query:
 * a missing order and someone else's order both come back null, so the
 * caller cannot distinguish (and cannot probe) other customers' orders.
 */
export async function getOrderForUser(userId: string, orderId: string) {
  await cancelOverdueUnpaidOrders();
  const customerProfile = await getActiveProfileForUser(prisma, userId);

  if (!customerProfile) {
    return null;
  }

  return prisma.order.findFirst({
    where: { id: orderId, customerProfileId: customerProfile.id },
    include: ORDER_INCLUDE,
  });
}

export async function getAllOrders() {
  await cancelOverdueUnpaidOrders();
  return prisma.order.findMany({
    include: {
      customerProfile: {
        /*
         * The admin Order Tracking table shows the customer's own
         * contact block (address/facebook) next to the receiver's, so
         * the list carries the display fields of the profile.
         */
        select: {
          id: true,
          customerNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          phoneNumber: true,
          contactEmail: true,
          facebookName: true,
          addressLine1: true,
          barangay: true,
          cityMunicipality: true,
          province: true,
        },
      },
      ...ORDER_INCLUDE,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrderById(orderId: string) {
  await cancelOverdueUnpaidOrders();
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customerProfile: {
        include: {
          user: {
            select: { email: true, status: true },
          },
          farms: {
            where: { archivedAt: null },
            orderBy: [{ isPrimary: "desc" }, { farmName: "asc" }],
          },
        },
      },
      /* The admin detail shows the order's payment history; historical
         imports carry summary rows without proof files. */
      payments: {
        orderBy: { createdAt: "asc" },
      },
      ...ORDER_INCLUDE,
    },
  });
}

/*
 * Explicit transition rules for staff:
 *
 *   PENDING           -> APPROVED | REJECTED | CANCELLED
 *   APPROVED          -> CANCELLED
 *   PAYMENT_SUBMITTED -> CANCELLED
 *   PAYMENT_VERIFIED  -> PROCESSING | CANCELLED
 *   PROCESSING        -> SHIPPED | DELIVERED | CANCELLED
 *   SHIPPED           -> DELIVERED
 *
 * SHIPPED and DELIVERED are separate customer-visible states (per the
 * approved mockups); pickup orders may skip SHIPPED entirely. The
 * APPROVED -> PAYMENT_SUBMITTED -> PAYMENT_VERIFIED steps belong to
 * Requirement 5 (payments) and cannot be set through this endpoint.
 *
 * CANCELLED terminates an order the customer withdrew (REJECTED remains
 * the staff-refusal terminal for PENDING quotations). Orders already
 * shipped or delivered cannot be cancelled, and terminal states never
 * transition again — cancelling twice is a 409, like every other
 * invalid transition. The order row itself is always preserved.
 */
function isAllowedTransition(
  currentStatus: OrderStatus,
  newStatus: StaffOrderStatus
): boolean {
  if (currentStatus === "PENDING") {
    return (
      newStatus === "APPROVED" ||
      newStatus === "REJECTED" ||
      newStatus === "CANCELLED"
    );
  }

  if (currentStatus === "APPROVED" || currentStatus === "PAYMENT_SUBMITTED") {
    return newStatus === "CANCELLED";
  }

  if (currentStatus === "PAYMENT_VERIFIED") {
    return newStatus === "PROCESSING" || newStatus === "CANCELLED";
  }

  if (currentStatus === "PROCESSING") {
    return (
      newStatus === "SHIPPED" ||
      newStatus === "DELIVERED" ||
      newStatus === "CANCELLED"
    );
  }

  if (currentStatus === "SHIPPED") {
    return newStatus === "DELIVERED";
  }

  return false;
}

export async function changeOrderStatus(
  actorUserId: string,
  orderId: string,
  newStatus: StaffOrderStatus,
  notes: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new HttpError(404, "Order was not found.");
    }

    if (!isAllowedTransition(order.status, newStatus)) {
      throw new HttpError(
        409,
        `Order cannot be changed from ${order.status} to ${newStatus}.`
      );
    }

    const previousStatus = order.status;

    const updateData: { status: StaffOrderStatus; releasedAt?: Date } = {
      status: newStatus,
    };

    /*
     * A delivered Parent Stock order's release date is the reference
     * point for the 90-day breeder eligibility rule (Requirement 7).
     * Once recorded it is never reset — the 90-day clock must not move.
     */
    const isParentStockRelease =
      newStatus === "DELIVERED" && order.orderType === "PARENT_STOCK";

    if (isParentStockRelease) {
      updateData.releasedAt = order.releasedAt ?? new Date();
    }

    await transaction.order.update({
      where: { id: order.id },
      data: updateData,
    });

    // Release starts the breeder monitoring cycle (idempotent: one
    // monitoring record per Parent Stock order).
    if (isParentStockRelease) {
      await startBreederMonitoringForReleasedOrder(
        transaction,
        actorUserId,
        order.id,
        updateData.releasedAt as Date,
        meta
      );
    }

    /*
     * The history row is the durable record of who cancelled/changed the
     * order and when; for cancellations, the staff-entered reason lands
     * in its notes.
     */
    await transaction.orderStatusHistory.create({
      data: {
        orderId: order.id,
        changedByUserId: actorUserId,
        fromStatus: previousStatus,
        toStatus: newStatus,
        notes,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "ORDERS",
      action: newStatus === "CANCELLED" ? "ORDER_CANCELLED" : "ORDER_STATUS_CHANGED",
      description:
        newStatus === "CANCELLED"
          ? `Order ${order.orderNumber} was cancelled (previously ${previousStatus}).`
          : `Order ${order.orderNumber} status was changed from ${previousStatus} to ${newStatus}.`,
      recordType: "Order",
      recordId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        previousStatus,
        newStatus,
        ...(newStatus === "CANCELLED" ? { reason: notes ?? null } : {}),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    /*
     * Refetched after the history insert so the response already
     * contains the transition that was just recorded.
     */
    return transaction.order.findUniqueOrThrow({
      where: { id: order.id },
      include: ORDER_INCLUDE,
    });
  });
}

export interface PaymentScheduleInput {
  depositPercent: number;
  depositDueDate: Date;
  balanceDueDate: Date;
}

/*
 * The agreed payment split ("30% deposit by 6/27, 70% balance by 7/7")
 * is part of the quotation staff prepare, so it varies per order and is
 * recorded as data — the balance share is always 100 - depositPercent.
 */
export async function setOrderPaymentSchedule(
  actorUserId: string,
  orderId: string,
  input: PaymentScheduleInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new HttpError(404, "Order was not found.");
    }

    const closedStatuses: OrderStatus[] = ["REJECTED", "CANCELLED", "DELIVERED"];

    if (closedStatuses.includes(order.status)) {
      throw new HttpError(
        409,
        `A payment schedule cannot be set on a ${order.status} order.`
      );
    }

    if (input.balanceDueDate.getTime() < input.depositDueDate.getTime()) {
      throw new HttpError(
        400,
        "The balance due date cannot be earlier than the deposit due date.",
        "balanceDueDate"
      );
    }

    const updated = await transaction.order.update({
      where: { id: order.id },
      data: {
        depositPercent: input.depositPercent,
        depositDueDate: input.depositDueDate,
        balanceDueDate: input.balanceDueDate,
      },
      include: ORDER_INCLUDE,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "ORDERS",
      action: "ORDER_PAYMENT_SCHEDULE_SET",
      description: `Payment schedule for order ${order.orderNumber} was set to ${input.depositPercent}% deposit / ${100 - input.depositPercent}% balance.`,
      recordType: "Order",
      recordId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        depositPercent: input.depositPercent,
        depositDueDate: input.depositDueDate.toISOString().slice(0, 10),
        balanceDueDate: input.balanceDueDate.toISOString().slice(0, 10),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  });
}

export interface UpdateOrderItemInput {
  productId: string;
  quantity: number;
  /*
   * Staff may set the agreed unit price (e.g. an F1 price negotiated
   * within the range). Omitted = keep the item's existing snapshot, or
   * the product's current price for newly added items. Farmers never
   * reach this endpoint, so this is not the injection vector the
   * create-order allowlist guards against.
   */
  unitPrice?: number;
}

export interface UpdateOrderInput {
  dateNeeded?: Date | null;
  hatchDate?: Date | null;
  receiverName?: string | null;
  receiverFacebook?: string | null;
  receiverContact?: string | null;
  fulfillmentMethod?: FulfillmentMethod | null;
  deliveryAddress?: string | null;
  airportLocation?: string | null;
  pickupBranch?: string | null;
  instructions?: string | null;
  /* Shipping/transportation cost; totals are recalculated with it. */
  feeTotal?: number;
  /* Full replacement of the order's line items when present. */
  items?: UpdateOrderItemInput[];
}

/*
 * Staff quotation editing (the admin "Edit Order" card). Only PENDING
 * and APPROVED orders are editable: once a payment proof arrives the
 * totals are what the customer is paying against, so item and fee
 * changes are frozen. Totals are always recalculated server-side —
 * subtotal from the line items, totalAmount = subtotal + feeTotal — and
 * never accepted from the client.
 */
export async function updateOrderDetails(
  actorUserId: string,
  orderId: string,
  input: UpdateOrderInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new HttpError(404, "Order was not found.");
    }

    if (order.status !== "PENDING" && order.status !== "APPROVED") {
      throw new HttpError(
        409,
        `A ${order.status} order can no longer be edited. Only pending or approved orders can be changed.`
      );
    }

    /*
     * Seminar orders sell fixed module access at the checkout-time
     * price: the line items are never editable (there is nothing to
     * re-quote). Reject/approve — or cancel and let the customer order
     * again — instead. Logistics fields and fees remain editable.
     */
    if (order.orderType === "SEMINAR" && input.items !== undefined) {
      throw new HttpError(
        409,
        "Seminar order items are fixed at checkout and cannot be edited."
      );
    }

    const data: Prisma.OrderUpdateInput = {};
    if (input.dateNeeded !== undefined) data.dateNeeded = input.dateNeeded;
    if (input.hatchDate !== undefined) data.hatchDate = input.hatchDate;
    if (input.receiverName !== undefined) data.receiverName = input.receiverName;
    if (input.receiverFacebook !== undefined)
      data.receiverFacebook = input.receiverFacebook;
    if (input.receiverContact !== undefined)
      data.receiverContact = input.receiverContact;
    if (input.fulfillmentMethod !== undefined)
      data.fulfillmentMethod = input.fulfillmentMethod;
    if (input.deliveryAddress !== undefined)
      data.deliveryAddress = input.deliveryAddress;
    if (input.airportLocation !== undefined)
      data.airportLocation = input.airportLocation;
    if (input.pickupBranch !== undefined) data.pickupBranch = input.pickupBranch;
    if (input.instructions !== undefined) data.instructions = input.instructions;

    if (
      Object.keys(data).length === 0 &&
      input.feeTotal === undefined &&
      input.items === undefined
    ) {
      throw new HttpError(400, "No editable fields were provided.");
    }

    /*
     * The chosen fulfillment method dictates which detail is required —
     * validated against the EFFECTIVE state (request value, or the
     * stored one when the request leaves a field untouched).
     */
    const effectiveMethod =
      input.fulfillmentMethod !== undefined
        ? input.fulfillmentMethod
        : order.fulfillmentMethod;
    const effectiveDeliveryAddress =
      input.deliveryAddress !== undefined
        ? input.deliveryAddress
        : order.deliveryAddress;
    const effectiveAirportLocation =
      input.airportLocation !== undefined
        ? input.airportLocation
        : order.airportLocation;
    const effectivePickupBranch =
      input.pickupBranch !== undefined ? input.pickupBranch : order.pickupBranch;

    if (effectiveMethod === "DELIVERY" && !effectiveDeliveryAddress) {
      throw new HttpError(
        400,
        "A delivery address is required for delivery orders.",
        "deliveryAddress"
      );
    }

    if (effectiveMethod === "AIRPORT" && !effectiveAirportLocation) {
      throw new HttpError(
        400,
        "An airport location is required for airport orders.",
        "airportLocation"
      );
    }

    if (effectiveMethod === "LBC_BRANCH" && !effectivePickupBranch) {
      throw new HttpError(
        400,
        "An LBC branch is required for LBC orders.",
        "pickupBranch"
      );
    }

    let subtotal = order.subtotal;

    if (input.items !== undefined) {
      const productIds = input.items.map((item) => item.productId);

      if (new Set(productIds).size !== productIds.length) {
        throw new HttpError(
          400,
          "The same product cannot appear in the order more than once.",
          "items"
        );
      }

      const products = await transaction.product.findMany({
        where: { id: { in: productIds }, isActive: true },
      });

      if (products.length !== productIds.length) {
        throw new HttpError(
          400,
          "One or more products do not exist or are inactive."
        );
      }

      const productMap = new Map(
        products.map((product) => [product.id, product])
      );
      const existingItemMap = new Map(
        order.items.map((item) => [item.productId, item])
      );

      subtotal = new Prisma.Decimal(0);
      const preparedItems = [];

      for (const requestedItem of input.items) {
        const product = productMap.get(requestedItem.productId)!;

        if (product.category !== order.orderType) {
          throw new HttpError(
            400,
            "Every product in the order must match the order type."
          );
        }

        /*
         * Snapshot rules: a retained item keeps its original snapshots
         * (what the order was quoted at), a new item snapshots the
         * current product, and an explicit unitPrice overrides either.
         */
        const existingItem = existingItemMap.get(product.id);

        const unitPriceSnapshot =
          requestedItem.unitPrice !== undefined
            ? new Prisma.Decimal(requestedItem.unitPrice.toFixed(2))
            : (existingItem?.unitPriceSnapshot ?? product.unitPrice);

        const lineTotal = unitPriceSnapshot.mul(requestedItem.quantity);
        subtotal = subtotal.add(lineTotal);

        preparedItems.push({
          productId: product.id,
          productCodeSnapshot:
            existingItem?.productCodeSnapshot ?? product.productCode,
          productNameSnapshot:
            existingItem?.productNameSnapshot ?? product.name,
          unitPriceSnapshot,
          quantity: requestedItem.quantity,
          lineTotal,
        });
      }

      // Full replacement inside the transaction; nothing references
      // order_items, so replacing the rows is safe.
      await transaction.orderItem.deleteMany({ where: { orderId: order.id } });
      data.items = { create: preparedItems };
      data.subtotal = subtotal;
    }

    const feeTotal =
      input.feeTotal !== undefined
        ? new Prisma.Decimal(input.feeTotal.toFixed(2))
        : order.feeTotal;

    if (input.feeTotal !== undefined) data.feeTotal = feeTotal;

    // Derived, never client-supplied.
    const updatedTotal = subtotal.add(feeTotal);
    assertTotalWithinBounds(updatedTotal);
    data.totalAmount = updatedTotal;

    const updated = await transaction.order.update({
      where: { id: order.id },
      data,
      include: ORDER_INCLUDE,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "ORDERS",
      action: "ORDER_UPDATED",
      description: `Order ${order.orderNumber} was edited by staff.`,
      recordType: "Order",
      recordId: order.id,
      metadata: {
        orderNumber: order.orderNumber,
        updatedFields: [
          ...Object.keys(data).filter(
            (key) => key !== "items" && key !== "totalAmount"
          ),
          ...(input.items !== undefined ? ["items"] : []),
        ],
        previousTotalAmount: order.totalAmount.toString(),
        totalAmount: updated.totalAmount.toString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  });
}
