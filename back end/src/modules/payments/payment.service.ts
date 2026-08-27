import { Prisma } from "../../../generated/prisma/client";
import type {
  PaymentStatus,
  PaymentType,
} from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export interface CreatePaymentInput {
  paymentType: PaymentType;
  amount: number;
  paymentDate: Date | null;
  referenceNumber: string | null;
  proofOriginalName: string;
  proofMimeType: string;
  proofSizeBytes: number;
  proofStorageUrl: string;
}

const PAYMENT_INCLUDE = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
      status: true,
      totalAmount: true,
    },
  },
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

export async function createPaymentForUser(
  userId: string,
  orderId: string,
  input: CreatePaymentInput,
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

    // Combined id + profile query: someone else's order looks identical
    // to a nonexistent one.
    const order = await transaction.order.findFirst({
      where: { id: orderId, customerProfileId: customerProfile.id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
      },
    });

    if (!order) {
      throw new HttpError(
        404,
        "Order was not found or does not belong to this account."
      );
    }

    /*
     * Payments open up once staff approves the order. PAYMENT_SUBMITTED
     * stays open so the farmer can send balance/additional proofs (or a
     * replacement after a rejection).
     */
    if (order.status !== "APPROVED" && order.status !== "PAYMENT_SUBMITTED") {
      throw new HttpError(
        409,
        `Payment proof cannot be submitted while the order status is ${order.status}.`
      );
    }

    const payment = await transaction.payment.create({
      data: {
        orderId: order.id,
        customerProfileId: customerProfile.id,
        paymentType: input.paymentType,
        amount: new Prisma.Decimal(input.amount),
        paymentDate: input.paymentDate,
        referenceNumber: input.referenceNumber,
        proofOriginalName: input.proofOriginalName,
        proofMimeType: input.proofMimeType,
        proofSizeBytes: input.proofSizeBytes,
        proofStorageUrl: input.proofStorageUrl,
        status: "SUBMITTED",
        statusHistory: {
          create: {
            changedByUserId: userId,
            fromStatus: null,
            toStatus: "SUBMITTED",
            notes: "Payment proof submitted by customer.",
          },
        },
      },
      include: PAYMENT_INCLUDE,
    });

    // The first proof moves the order from APPROVED to PAYMENT_SUBMITTED.
    if (order.status === "APPROVED") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "PAYMENT_SUBMITTED" },
      });

      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          changedByUserId: userId,
          fromStatus: "APPROVED",
          toStatus: "PAYMENT_SUBMITTED",
          notes: "Payment proof submitted.",
        },
      });
    }

    await recordActivity(transaction, {
      userId,
      module: "PAYMENTS",
      action: "PAYMENT_PROOF_SUBMITTED",
      description: `Payment proof for order ${order.orderNumber} was submitted.`,
      recordType: "Payment",
      recordId: payment.id,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentType: payment.paymentType,
        amount: payment.amount.toString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return payment;
  });
}

export interface RecordPaymentInput {
  paymentType: PaymentType;
  amount: number;
  paymentDate: Date | null;
  referenceNumber: string | null;
  notes: string | null;
}

/*
 * Staff-recorded payment: the customer process is to EMAIL the proof of
 * payment to DACS (no in-app upload), so staff need a way to enter the
 * received payment against the order. The payment row is created
 * directly VERIFIED (staff have already reviewed the emailed proof) with
 * no proof file — the email itself is the proof artifact. Any payment
 * row on the order also stops the 14-day auto-cancel sweep.
 */
export async function recordPaymentByStaff(
  actorUserId: string,
  orderId: string,
  input: RecordPaymentInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        source: true,
        customerProfileId: true,
      },
    });

    if (!order) {
      throw new HttpError(404, "Order was not found.");
    }

    if (order.source === "HISTORICAL_IMPORT") {
      throw new HttpError(
        409,
        "Historical imported orders are legacy records — payments cannot be recorded against them."
      );
    }

    if (order.status === "PENDING") {
      throw new HttpError(
        409,
        "Approve the order first, then record the payment."
      );
    }

    // Same window as customer proofs: payments attach to an APPROVED
    // order, and stay open while earlier payments are under that order.
    if (order.status !== "APPROVED" && order.status !== "PAYMENT_SUBMITTED") {
      throw new HttpError(
        409,
        `A payment cannot be recorded while the order status is ${order.status}.`
      );
    }

    const verifiedAt = new Date();

    const payment = await transaction.payment.create({
      data: {
        orderId: order.id,
        customerProfileId: order.customerProfileId,
        paymentType: input.paymentType,
        amount: new Prisma.Decimal(input.amount),
        paymentDate: input.paymentDate,
        referenceNumber: input.referenceNumber,
        status: "VERIFIED",
        verifiedByUserId: actorUserId,
        verifiedAt,
        verificationNotes: input.notes,
        statusHistory: {
          create: {
            changedByUserId: actorUserId,
            fromStatus: null,
            toStatus: "VERIFIED",
            notes:
              input.notes ??
              "Payment recorded by DACS staff from the emailed proof of payment.",
          },
        },
      },
    });

    if (order.status === "APPROVED") {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "PAYMENT_SUBMITTED" },
      });

      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          changedByUserId: actorUserId,
          fromStatus: "APPROVED",
          toStatus: "PAYMENT_SUBMITTED",
          notes: "Payment recorded by DACS staff.",
        },
      });
    }

    /*
     * Same aggregation rule as verifyPayment: the ORDER only becomes
     * PAYMENT_VERIFIED once verified money covers its total, so a
     * recorded DEPOSIT leaves it at PAYMENT_SUBMITTED until the BALANCE
     * arrives.
     */
    const verifiedPayments = await transaction.payment.aggregate({
      where: { orderId: order.id, status: "VERIFIED" },
      _sum: { amount: true },
    });

    const verifiedTotal =
      verifiedPayments._sum.amount ?? new Prisma.Decimal(0);

    let orderStatusUpdated = false;

    if (verifiedTotal.gte(order.totalAmount)) {
      await transaction.order.update({
        where: { id: order.id },
        data: { status: "PAYMENT_VERIFIED" },
      });

      await transaction.orderStatusHistory.create({
        data: {
          orderId: order.id,
          changedByUserId: actorUserId,
          fromStatus: "PAYMENT_SUBMITTED",
          toStatus: "PAYMENT_VERIFIED",
          notes: "Verified payment total covers the order total.",
        },
      });

      orderStatusUpdated = true;
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PAYMENTS",
      action: "PAYMENT_RECORDED_BY_STAFF",
      description: `A ${input.paymentType} payment for order ${order.orderNumber} was recorded by staff.`,
      recordType: "Payment",
      recordId: payment.id,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        paymentType: payment.paymentType,
        amount: payment.amount.toString(),
        verifiedTotal: verifiedTotal.toString(),
        orderStatusUpdated,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const recordedPayment = await transaction.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: {
        ...PAYMENT_INCLUDE,
        verifiedBy: {
          select: { id: true, email: true },
        },
      },
    });

    return {
      payment: recordedPayment,
      verifiedTotal,
      orderStatusUpdated,
    };
  });
}

export async function getPaymentsForUser(userId: string) {
  const customerProfile = await getActiveProfileForUser(prisma, userId);

  if (!customerProfile) {
    return null;
  }

  const payments = await prisma.payment.findMany({
    where: { customerProfileId: customerProfile.id },
    include: PAYMENT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  return {
    customerNumber: customerProfile.customerNumber,
    payments,
  };
}

export async function getAllPayments(status?: PaymentStatus) {
  return prisma.payment.findMany({
    where: status ? { status } : undefined,
    include: {
      ...PAYMENT_INCLUDE,
      customerProfile: {
        select: {
          id: true,
          customerNumber: true,
          firstName: true,
          lastName: true,
          contactEmail: true,
          phoneNumber: true,
        },
      },
      verifiedBy: {
        select: { id: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPaymentById(paymentId: string) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          items: true,
          statusHistory: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
      customerProfile: {
        include: {
          farms: {
            where: { archivedAt: null },
            orderBy: [{ isPrimary: "desc" }, { farmName: "asc" }],
          },
        },
      },
      verifiedBy: {
        select: { id: true, email: true, role: true },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function verifyPayment(
  actorUserId: string,
  paymentId: string,
  notes: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new HttpError(404, "Payment was not found.");
    }

    if (payment.status !== "SUBMITTED") {
      throw new HttpError(
        409,
        `This payment has already been ${payment.status.toLowerCase()}.`
      );
    }

    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: "VERIFIED",
        verifiedByUserId: actorUserId,
        verifiedAt: new Date(),
        verificationNotes: notes,
        rejectionReason: null,
      },
    });

    await transaction.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        changedByUserId: actorUserId,
        fromStatus: "SUBMITTED",
        toStatus: "VERIFIED",
        notes,
      },
    });

    /*
     * Sum every VERIFIED payment on this order so DEPOSIT + BALANCE
     * combinations work: one verified proof does not automatically mean
     * the order is fully paid.
     */
    const verifiedPayments = await transaction.payment.aggregate({
      where: { orderId: payment.orderId, status: "VERIFIED" },
      _sum: { amount: true },
    });

    const verifiedTotal =
      verifiedPayments._sum.amount ?? new Prisma.Decimal(0);

    let orderStatusUpdated = false;

    // The ORDER only becomes PAYMENT_VERIFIED once verified money covers
    // its total.
    if (
      payment.order.status === "PAYMENT_SUBMITTED" &&
      verifiedTotal.gte(payment.order.totalAmount)
    ) {
      await transaction.order.update({
        where: { id: payment.order.id },
        data: { status: "PAYMENT_VERIFIED" },
      });

      await transaction.orderStatusHistory.create({
        data: {
          orderId: payment.order.id,
          changedByUserId: actorUserId,
          fromStatus: "PAYMENT_SUBMITTED",
          toStatus: "PAYMENT_VERIFIED",
          notes: "Verified payment total covers the order total.",
        },
      });

      orderStatusUpdated = true;
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PAYMENTS",
      action: "PAYMENT_VERIFIED",
      description: `Payment for order ${payment.order.orderNumber} was verified.`,
      recordType: "Payment",
      recordId: payment.id,
      metadata: {
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        amount: payment.amount.toString(),
        verifiedTotal: verifiedTotal.toString(),
        orderStatusUpdated,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const updatedPayment = await transaction.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: {
        ...PAYMENT_INCLUDE,
        verifiedBy: {
          select: { id: true, email: true },
        },
      },
    });

    return {
      payment: updatedPayment,
      verifiedTotal,
      orderStatusUpdated,
    };
  });
}

export async function rejectPayment(
  actorUserId: string,
  paymentId: string,
  rejectionReason: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });

    if (!payment) {
      throw new HttpError(404, "Payment was not found.");
    }

    if (payment.status !== "SUBMITTED") {
      throw new HttpError(
        409,
        `This payment has already been ${payment.status.toLowerCase()}.`
      );
    }

    await transaction.payment.update({
      where: { id: payment.id },
      data: {
        status: "REJECTED",
        rejectionReason,
        verificationNotes: null,
        verifiedByUserId: null,
        verifiedAt: null,
      },
    });

    await transaction.paymentStatusHistory.create({
      data: {
        paymentId: payment.id,
        changedByUserId: actorUserId,
        fromStatus: "SUBMITTED",
        toStatus: "REJECTED",
        notes: rejectionReason,
      },
    });

    /*
     * The order deliberately stays PAYMENT_SUBMITTED so the farmer can
     * upload a corrected proof.
     */
    await recordActivity(transaction, {
      userId: actorUserId,
      module: "PAYMENTS",
      action: "PAYMENT_REJECTED",
      description: `Payment for order ${payment.order.orderNumber} was rejected.`,
      recordType: "Payment",
      recordId: payment.id,
      metadata: {
        orderId: payment.order.id,
        orderNumber: payment.order.orderNumber,
        amount: payment.amount.toString(),
        rejectionReason,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: PAYMENT_INCLUDE,
    });
  });
}
