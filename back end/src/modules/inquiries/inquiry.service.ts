import { Prisma } from "../../../generated/prisma/client";
import type { InquiryTicketStatus } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { notifyStaff } from "../notifications/notification.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

/*
 * Advisory-lock key for INQ-YYYY-XXXXXX ticket numbers (43010001 DAPG,
 * 43010002 ORD, 43010003 SEM, 43010007 BRD).
 */
const TICKET_NUMBER_LOCK_KEY = 43010008;

export interface CreateInquiryInput {
  subject: string;
  message: string;
  relatedOrderId?: string | null;
}

export interface InquiryListFilters {
  status?: InquiryTicketStatus;
  category?: string;
  priority?: string;
  assignedToUserId?: string;
  relatedOrderId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

async function getActiveProfileForUser(
  client: Prisma.TransactionClient,
  userId: string
) {
  return client.customerProfile.findFirst({
    where: { userId, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
}

function requireProfile<T>(profile: T | null): T {
  if (!profile) {
    throw new HttpError(
      404,
      "No active customer profile is linked to this account."
    );
  }
  return profile;
}

async function generateTicketNumber(
  transaction: Prisma.TransactionClient
): Promise<string> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${TICKET_NUMBER_LOCK_KEY})`;

  const year = new Date().getFullYear();
  const prefix = `INQ-${year}-`;

  const latest = await transaction.inquiryTicket.findFirst({
    where: { ticketNumber: { startsWith: prefix } },
    orderBy: { ticketNumber: "desc" },
    select: { ticketNumber: true },
  });

  let nextNumber = 1;

  if (latest?.ticketNumber) {
    const previous = Number(latest.ticketNumber.slice(prefix.length));
    if (Number.isFinite(previous)) {
      nextNumber = previous + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(6, "0")}`;
}

export async function createInquiryTicket(
  userId: string,
  input: CreateInquiryInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const customer = requireProfile(
      await getActiveProfileForUser(transaction, userId)
    );

    /*
     * A linked order must belong to this customer — the combined query
     * makes someone else's order indistinguishable from a nonexistent
     * one.
     */
    if (input.relatedOrderId) {
      const relatedOrder = await transaction.order.findFirst({
        where: { id: input.relatedOrderId, customerProfileId: customer.id },
        select: { id: true },
      });

      if (!relatedOrder) {
        throw new HttpError(
          404,
          "The related order was not found for this customer."
        );
      }
    }

    const ticketNumber = await generateTicketNumber(transaction);

    const ticket = await transaction.inquiryTicket.create({
      data: {
        ticketNumber,
        customerProfileId: customer.id,
        relatedOrderId: input.relatedOrderId ?? null,
        subject: input.subject,
        message: input.message,
        status: "SUBMITTED",
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: "SUBMITTED",
            changedByUserId: userId,
            notes: "Inquiry ticket submitted by customer.",
          },
        },
      },
      include: {
        relatedOrder: {
          select: { id: true, orderNumber: true, status: true },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await recordActivity(transaction, {
      userId,
      module: "INQUIRIES",
      action: "INQUIRY_TICKET_CREATED",
      description: `Inquiry ticket ${ticket.ticketNumber} was submitted.`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
      metadata: { ticketNumber: ticket.ticketNumber },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await notifyStaff(transaction, userId, {
      type: "NEW_TICKET",
      title: "New inquiry ticket",
      message: `${customer.customerNumber} submitted ticket ${ticket.ticketNumber}: ${ticket.subject}`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
    });

    return ticket;
  });
}

export async function getMyInquiryTickets(
  userId: string,
  status?: InquiryTicketStatus
) {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  const tickets = await prisma.inquiryTicket.findMany({
    where: { customerProfileId: customer.id, status },
    include: {
      relatedOrder: {
        select: { id: true, orderNumber: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    customerNumber: customer.customerNumber,
    tickets,
  };
}

/*
 * Combined id + profile query: another customer's ticket returns the
 * same 404 as a nonexistent one.
 */
export async function getMyInquiryTicket(userId: string, ticketId: string) {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  const ticket = await prisma.inquiryTicket.findFirst({
    where: { id: ticketId, customerProfileId: customer.id },
    include: {
      relatedOrder: {
        select: { id: true, orderNumber: true, status: true },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    throw new HttpError(404, "Inquiry ticket was not found.");
  }

  return ticket;
}

export async function listInquiryTickets(filters: InquiryListFilters) {
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);

  const where: Prisma.InquiryTicketWhereInput = {
    status: filters.status,
    assignedToUserId: filters.assignedToUserId,
    relatedOrderId: filters.relatedOrderId,
    ...(filters.category
      ? { category: { equals: filters.category, mode: "insensitive" } }
      : {}),
    ...(filters.priority
      ? { priority: { equals: filters.priority, mode: "insensitive" } }
      : {}),
  };

  if (filters.search) {
    where.OR = [
      { ticketNumber: { contains: filters.search, mode: "insensitive" } },
      { subject: { contains: filters.search, mode: "insensitive" } },
      { message: { contains: filters.search, mode: "insensitive" } },
      { category: { contains: filters.search, mode: "insensitive" } },
      {
        customerProfile: {
          customerNumber: { contains: filters.search, mode: "insensitive" },
        },
      },
    ];
  }

  const [records, total] = await prisma.$transaction([
    prisma.inquiryTicket.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      include: {
        customerProfile: {
          /* The admin Ticket Monitoring table shows the customer's
             contact block (address/facebook) beside the ticket. */
          select: {
            id: true,
            customerNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
            contactEmail: true,
            phoneNumber: true,
            facebookName: true,
            addressLine1: true,
            barangay: true,
            cityMunicipality: true,
            province: true,
          },
        },
        relatedOrder: {
          select: { id: true, orderNumber: true, status: true },
        },
        assignedTo: {
          select: { id: true, email: true },
        },
      },
    }),
    prisma.inquiryTicket.count({ where }),
  ]);

  return {
    records,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getInquiryTicket(ticketId: string) {
  const ticket = await prisma.inquiryTicket.findUnique({
    where: { id: ticketId },
    include: {
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
      relatedOrder: {
        select: { id: true, orderNumber: true, status: true },
      },
      assignedTo: {
        select: { id: true, email: true, role: true },
      },
      emailRespondedBy: {
        select: { id: true, email: true },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        include: {
          changedBy: { select: { id: true, email: true } },
        },
      },
    },
  });

  if (!ticket) {
    throw new HttpError(404, "Inquiry ticket was not found.");
  }

  return ticket;
}

export async function classifyInquiryTicket(
  actorUserId: string,
  ticketId: string,
  input: { category?: string | null; priority?: string | null },
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.inquiryTicket.findUnique({
      where: { id: ticketId },
    });

    if (!existing) {
      throw new HttpError(404, "Inquiry ticket was not found.");
    }

    const data: Prisma.InquiryTicketUpdateInput = {};
    if (input.category !== undefined) data.category = input.category;
    if (input.priority !== undefined) data.priority = input.priority;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "A category or priority must be supplied.");
    }

    const ticket = await transaction.inquiryTicket.update({
      where: { id: ticketId },
      data,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "INQUIRIES",
      action: "INQUIRY_CLASSIFIED",
      description: `Inquiry ticket ${ticket.ticketNumber} classification was updated.`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
      metadata: { category: ticket.category, priority: ticket.priority },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return ticket;
  });
}

export async function assignInquiryTicket(
  actorUserId: string,
  ticketId: string,
  assignedToUserId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const ticket = await transaction.inquiryTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new HttpError(404, "Inquiry ticket was not found.");
    }

    // Only ticket-handling staff can be assigned — never a customer.
    const assignee = await transaction.user.findFirst({
      where: {
        id: assignedToUserId,
        role: { in: ["OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"] },
      },
      select: { id: true, email: true },
    });

    if (!assignee) {
      throw new HttpError(
        400,
        "The selected user cannot be assigned to inquiry tickets."
      );
    }

    const updated = await transaction.inquiryTicket.update({
      where: { id: ticket.id },
      data: {
        assignedToUserId: assignee.id,
        assignedAt: new Date(),
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "INQUIRIES",
      action: "INQUIRY_ASSIGNED",
      description: `Inquiry ticket ${ticket.ticketNumber} was assigned to ${assignee.email}.`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
      metadata: { assignedToUserId: assignee.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  });
}

export async function changeInquiryTicketStatus(
  actorUserId: string,
  ticketId: string,
  nextStatus: InquiryTicketStatus,
  notes: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const ticket = await transaction.inquiryTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new HttpError(404, "Inquiry ticket was not found.");
    }

    /*
     * RESPONDED must go through the email-response workflow so the
     * status can never exist without a recorded email response.
     */
    if (nextStatus === "RESPONDED") {
      throw new HttpError(
        409,
        "Use the email-response endpoint when marking an inquiry as responded."
      );
    }

    // No closing a ticket DACS has no response record for.
    if (nextStatus === "CLOSED" && !ticket.emailRespondedAt) {
      throw new HttpError(
        409,
        "An email response must be recorded before the ticket can be closed."
      );
    }

    if (ticket.status === nextStatus) {
      throw new HttpError(409, "The ticket already has this status.");
    }

    const now = new Date();

    const updated = await transaction.inquiryTicket.update({
      where: { id: ticket.id },
      data: {
        status: nextStatus,
        underReviewAt:
          nextStatus === "UNDER_REVIEW"
            ? (ticket.underReviewAt ?? now)
            : undefined,
        closedAt:
          nextStatus === "CLOSED" ? (ticket.closedAt ?? now) : undefined,
      },
      include: {
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    await transaction.ticketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: nextStatus,
        changedByUserId: actorUserId,
        notes,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "INQUIRIES",
      action: "INQUIRY_STATUS_CHANGED",
      description: `Inquiry ticket ${ticket.ticketNumber} changed from ${ticket.status} to ${nextStatus}.`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
      metadata: { fromStatus: ticket.status, toStatus: nextStatus },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.inquiryTicket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: {
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });
}

/*
 * The Requirement 8 heart: staff sends the actual reply through the
 * organization's official email, then records it here. DACS stores who,
 * when, and an optional reference — and the status becomes RESPONDED.
 */
export async function recordInquiryEmailResponse(
  actorUserId: string,
  ticketId: string,
  input: {
    emailResponseReference?: string | null;
    emailResponseNotes?: string | null;
  },
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const ticket = await transaction.inquiryTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new HttpError(404, "Inquiry ticket was not found.");
    }

    if (ticket.status === "CLOSED") {
      throw new HttpError(
        409,
        "A closed inquiry cannot be updated with a new email response."
      );
    }

    const now = new Date();
    const previousStatus = ticket.status;

    await transaction.inquiryTicket.update({
      where: { id: ticket.id },
      data: {
        status: "RESPONDED",
        respondedAt: ticket.respondedAt ?? now,
        emailRespondedAt: now,
        emailRespondedByUserId: actorUserId,
        emailResponseReference: input.emailResponseReference ?? null,
        emailResponseNotes: input.emailResponseNotes ?? null,
      },
    });

    if (previousStatus !== "RESPONDED") {
      await transaction.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: previousStatus,
          toStatus: "RESPONDED",
          changedByUserId: actorUserId,
          notes:
            "Inquiry response sent through the organization's official email channel.",
        },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "INQUIRIES",
      action: "INQUIRY_EMAIL_RESPONSE_RECORDED",
      description: `Email response for inquiry ticket ${ticket.ticketNumber} was recorded.`,
      recordType: "InquiryTicket",
      recordId: ticket.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.inquiryTicket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: {
        emailRespondedBy: {
          select: { id: true, email: true },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  });
}
