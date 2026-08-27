import type { NextFunction, Request, Response } from "express";

import type { InquiryTicketStatus } from "../../../generated/prisma/client";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  assignInquiryTicket,
  changeInquiryTicketStatus,
  classifyInquiryTicket,
  createInquiryTicket,
  getInquiryTicket,
  getMyInquiryTicket,
  getMyInquiryTickets,
  listInquiryTickets,
  recordInquiryEmailResponse,
} from "./inquiry.service";

const VALID_TICKET_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "RESPONDED",
  "CLOSED",
] as const;

const CREATE_FIELDS = ["subject", "message", "relatedOrderId"] as const;
const CLASSIFY_FIELDS = ["category", "priority"] as const;

function parseStatusQuery(value: unknown): InquiryTicketStatus | undefined {
  if (value === undefined) return undefined;

  if (
    typeof value !== "string" ||
    !VALID_TICKET_STATUSES.includes(value as InquiryTicketStatus)
  ) {
    throw new HttpError(400, "The inquiry-status filter is not valid.");
  }

  return value as InquiryTicketStatus;
}

function requireActor(request: Request, response: Response) {
  const actor = request.dacsUser;

  if (!actor) {
    response.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
    return null;
  }

  return actor;
}

function requestMeta(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}

export async function createInquiry(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, CREATE_FIELDS);

    let relatedOrderId: string | null = null;

    if (raw.relatedOrderId !== undefined && raw.relatedOrderId !== null) {
      relatedOrderId = requiredUuid(raw.relatedOrderId, "The related order ID");
    }

    const ticket = await createInquiryTicket(
      actor.id,
      {
        subject: requiredString(raw.subject, "Subject", 150),
        message: requiredString(raw.message, "Message", 3000),
        relatedOrderId,
      },
      requestMeta(request)
    );

    response.status(201).json({
      success: true,
      message: "Inquiry ticket was submitted successfully.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyInquiries(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const status = parseStatusQuery(request.query.status);
    const result = await getMyInquiryTickets(actor.id, status);

    response.json({
      success: true,
      customerNumber: result.customerNumber,
      count: result.tickets.length,
      data: result.tickets,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyInquiry(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");
    const ticket = await getMyInquiryTicket(actor.id, ticketId);

    response.json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function listInquiries(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const status = parseStatusQuery(request.query.status);

    const page = Number(request.query.page ?? 1);
    const pageSize = Number(request.query.pageSize ?? 25);

    const result = await listInquiryTickets({
      status,
      category:
        typeof request.query.category === "string"
          ? request.query.category
          : undefined,
      priority:
        typeof request.query.priority === "string"
          ? request.query.priority
          : undefined,
      assignedToUserId:
        typeof request.query.assignedToUserId === "string"
          ? request.query.assignedToUserId
          : undefined,
      relatedOrderId:
        typeof request.query.relatedOrderId === "string"
          ? request.query.relatedOrderId
          : undefined,
      search:
        typeof request.query.search === "string"
          ? request.query.search
          : undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    });

    response.json({
      success: true,
      count: result.records.length,
      pagination: result.pagination,
      data: result.records,
    });
  } catch (error) {
    next(error);
  }
}

export async function getInquiry(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");
    const ticket = await getInquiryTicket(ticketId);

    response.json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function classifyInquiry(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, CLASSIFY_FIELDS);

    const ticket = await classifyInquiryTicket(
      actor.id,
      ticketId,
      {
        category: optionalString(raw.category, "Category", 100),
        priority: optionalString(raw.priority, "Priority", 50),
      },
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Inquiry ticket classification was updated.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function assignInquiry(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["assignedToUserId"]);

    const assignedToUserId = requiredUuid(
      raw.assignedToUserId,
      "The assignee's user ID"
    );

    const ticket = await assignInquiryTicket(
      actor.id,
      ticketId,
      assignedToUserId,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Inquiry ticket was assigned successfully.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function changeInquiryStatus(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["status", "notes"]);

    if (
      typeof raw.status !== "string" ||
      !VALID_TICKET_STATUSES.includes(raw.status as InquiryTicketStatus)
    ) {
      throw new HttpError(400, "The requested inquiry status is not valid.");
    }

    const ticket = await changeInquiryTicketStatus(
      actor.id,
      ticketId,
      raw.status as InquiryTicketStatus,
      optionalString(raw.notes, "Notes", 500) ?? null,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Inquiry ticket status was updated.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}

export async function recordEmailResponse(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const ticketId = requiredUuid(request.params.ticketId, "The ticket ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["emailResponseReference", "emailResponseNotes"]);

    const ticket = await recordInquiryEmailResponse(
      actor.id,
      ticketId,
      {
        emailResponseReference: optionalString(
          raw.emailResponseReference,
          "Email response reference",
          200
        ),
        emailResponseNotes: optionalString(
          raw.emailResponseNotes,
          "Email response notes",
          1000
        ),
      },
      requestMeta(request)
    );

    response.json({
      success: true,
      message: "Email response was recorded and the ticket is now responded.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
}
