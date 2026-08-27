import type { NextFunction, Request, Response } from "express";

import type {
  PaymentStatus,
  PaymentType,
} from "../../../generated/prisma/client";

import {
  deleteFileByUrl,
  saveFile,
} from "../../services/fileStorage.service";
import { HttpError } from "../../utils/httpError";
import { detectProofType } from "../../utils/imageType";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredUuid,
} from "../../utils/validation";
import {
  createPaymentForUser,
  getAllPayments,
  getPaymentById,
  getPaymentsForUser,
  recordPaymentByStaff,
  rejectPayment,
  verifyPayment,
} from "./payment.service";

const VALID_PAYMENT_TYPES = [
  "DEPOSIT",
  "BALANCE",
  "FULL",
  "SHIPPING_FEE",
  "PROCESSING_FEE",
] as const;

const VALID_PAYMENT_STATUSES = ["SUBMITTED", "VERIFIED", "REJECTED"] as const;

// amount arrives as text because the body is multipart/form-data.
const PAYMENT_PROOF_FIELDS = [
  "paymentType",
  "amount",
  "paymentDate",
  "referenceNumber",
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Upper bound mirrors the Decimal(12,2) money columns so an oversized
// amount is rejected as a clean 400 instead of overflowing at insert.
const MAX_PAYMENT_AMOUNT = 9_999_999_999.99;

function optionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !DATE_PATTERN.test(value.trim())) {
    throw new HttpError(400, `${field} must use YYYY-MM-DD format.`, field);
  }

  const date = new Date(`${value.trim()}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${field} is not a valid date.`, field);
  }

  return date;
}

export async function submitPaymentProof(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  let savedProofUrl: string | null = null;

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

    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: "A proof-of-payment file is required.",
      });
      return;
    }

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, PAYMENT_PROOF_FIELDS);

    if (
      typeof raw.paymentType !== "string" ||
      !VALID_PAYMENT_TYPES.includes(raw.paymentType as PaymentType)
    ) {
      response.status(400).json({
        success: false,
        message: "A valid payment type is required.",
      });
      return;
    }

    const amount = Number(raw.amount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_AMOUNT) {
      response.status(400).json({
        success: false,
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    const paymentDate = optionalDate(raw.paymentDate, "paymentDate");
    const referenceNumber =
      optionalString(raw.referenceNumber, "Reference number", 100) ?? null;

    // Trust the file's magic bytes, not its client-supplied content type.
    const detectedType = detectProofType(file.buffer);

    if (!detectedType) {
      response.status(400).json({
        success: false,
        message:
          "Only JPEG, PNG, WebP, and PDF payment proofs are allowed.",
      });
      return;
    }

    const filename = `proof-${user.id}-${Date.now()}.${detectedType.extension}`;
    savedProofUrl = await saveFile("payment-proofs", filename, file.buffer);

    let payment;
    try {
      payment = await createPaymentForUser(
        user.id,
        orderId,
        {
          paymentType: raw.paymentType as PaymentType,
          amount,
          paymentDate,
          referenceNumber,
          proofOriginalName: file.originalname,
          proofMimeType: detectedType.mimeType,
          proofSizeBytes: file.size,
          proofStorageUrl: savedProofUrl,
        },
        {
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
        }
      );
    } catch (serviceError) {
      // No payment row was written, so the stored file must not linger.
      await deleteFileByUrl(savedProofUrl);
      savedProofUrl = null;
      throw serviceError;
    }

    response.status(201).json({
      success: true,
      message: "Payment proof was submitted successfully.",
      data: payment,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Staff entry point for payments whose proof arrived by email (the
 * customer process — no in-app upload). JSON body, no file: the payment
 * is recorded as already VERIFIED by the acting staff member.
 */
export async function recordOrderPayment(
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
      "paymentType",
      "amount",
      "paymentDate",
      "referenceNumber",
      "notes",
    ]);

    if (
      typeof raw.paymentType !== "string" ||
      !VALID_PAYMENT_TYPES.includes(raw.paymentType as PaymentType)
    ) {
      response.status(400).json({
        success: false,
        message: "A valid payment type is required.",
      });
      return;
    }

    const amount = Number(raw.amount);

    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_AMOUNT) {
      response.status(400).json({
        success: false,
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    const paymentDate = optionalDate(raw.paymentDate, "paymentDate");
    const referenceNumber =
      optionalString(raw.referenceNumber, "Reference number", 100) ?? null;
    const notes = optionalString(raw.notes, "Notes", 500) ?? null;

    const result = await recordPaymentByStaff(
      actor.id,
      orderId,
      {
        paymentType: raw.paymentType as PaymentType,
        amount,
        paymentDate,
        referenceNumber,
        notes,
      },
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.status(201).json({
      success: true,
      message: "Payment was recorded successfully.",
      verifiedTotal: result.verifiedTotal.toString(),
      orderStatusUpdated: result.orderStatusUpdated,
      data: result.payment,
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyPayments(
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

    const result = await getPaymentsForUser(user.id);

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
      count: result.payments.length,
      data: result.payments,
    });
  } catch (error) {
    next(error);
  }
}

export async function listPayments(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    let status: PaymentStatus | undefined;

    if (request.query.status !== undefined) {
      if (
        typeof request.query.status !== "string" ||
        !VALID_PAYMENT_STATUSES.includes(request.query.status as PaymentStatus)
      ) {
        response.status(400).json({
          success: false,
          message: "The payment-status filter is not valid.",
        });
        return;
      }

      status = request.query.status as PaymentStatus;
    }

    const payments = await getAllPayments(status);

    response.json({
      success: true,
      count: payments.length,
      filter: { status: status ?? null },
      data: payments,
    });
  } catch (error) {
    next(error);
  }
}

export async function getIndividualPayment(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paymentId = requiredUuid(request.params.paymentId, "The payment ID");
    const payment = await getPaymentById(paymentId);

    if (!payment) {
      response.status(404).json({
        success: false,
        message: "Payment was not found.",
      });
      return;
    }

    response.json({
      success: true,
      data: payment,
    });
  } catch (error) {
    next(error);
  }
}

export async function approvePayment(
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

    const paymentId = requiredUuid(request.params.paymentId, "The payment ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["notes"]);

    const result = await verifyPayment(
      actor.id,
      paymentId,
      optionalString(raw.notes, "Notes", 500) ?? null,
      {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }
    );

    response.json({
      success: true,
      message: "Payment was verified successfully.",
      verifiedTotal: result.verifiedTotal.toString(),
      orderStatusUpdated: result.orderStatusUpdated,
      data: result.payment,
    });
  } catch (error) {
    next(error);
  }
}

export async function denyPayment(
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

    const paymentId = requiredUuid(request.params.paymentId, "The payment ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["rejectionReason"]);

    const rejectionReason =
      optionalString(raw.rejectionReason, "Rejection reason", 500) ?? null;

    if (!rejectionReason) {
      response.status(400).json({
        success: false,
        message: "A rejection reason is required.",
      });
      return;
    }

    const payment = await rejectPayment(actor.id, paymentId, rejectionReason, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Payment was rejected successfully.",
      data: payment,
    });
  } catch (error) {
    next(error);
  }
}
