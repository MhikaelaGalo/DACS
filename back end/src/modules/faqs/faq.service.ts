import { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

export interface CreateFaqInput {
  category?: string | null;
  question: string;
  answer: string;
  displayOrder?: number;
}

export interface UpdateFaqInput {
  category?: string | null;
  question?: string;
  answer?: string;
  displayOrder?: number;
}

export interface FaqFilters {
  category?: string;
  search?: string;
}

function buildFaqWhere(
  filters: FaqFilters,
  publishedOnly: boolean
): Prisma.FaqWhereInput {
  const where: Prisma.FaqWhereInput = {};

  if (publishedOnly) {
    where.isPublished = true;
  }

  if (filters.category) {
    where.category = { equals: filters.category, mode: "insensitive" };
  }

  if (filters.search) {
    where.OR = [
      { question: { contains: filters.search, mode: "insensitive" } },
      { answer: { contains: filters.search, mode: "insensitive" } },
      { category: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return where;
}

/*
 * The public FAQ list: published entries only, no authentication, no
 * staff metadata in the payload.
 */
export async function getPublishedFaqs(filters: FaqFilters) {
  return prisma.faq.findMany({
    where: buildFaqWhere(filters, true),
    select: {
      id: true,
      category: true,
      question: true,
      answer: true,
      displayOrder: true,
      updatedAt: true,
    },
    orderBy: [{ displayOrder: "asc" }, { question: "asc" }],
  });
}

/*
 * The staff view: drafts included, with creator/updater attribution.
 */
export async function getAllFaqs(
  filters: FaqFilters & { isPublished?: boolean }
) {
  const where = buildFaqWhere(filters, false);

  if (filters.isPublished !== undefined) {
    where.isPublished = filters.isPublished;
  }

  return prisma.faq.findMany({
    where,
    include: {
      createdBy: { select: { id: true, email: true } },
      updatedBy: { select: { id: true, email: true } },
    },
    orderBy: [{ displayOrder: "asc" }, { question: "asc" }],
  });
}

export async function createFaq(
  actorUserId: string,
  input: CreateFaqInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    /*
     * New FAQs default to the end of the list so they never displace
     * an existing curated order.
     */
    let displayOrder = input.displayOrder;

    if (displayOrder === undefined) {
      const last = await transaction.faq.findFirst({
        orderBy: { displayOrder: "desc" },
        select: { displayOrder: true },
      });
      displayOrder = (last?.displayOrder ?? 0) + 1;
    }

    const faq = await transaction.faq.create({
      data: {
        category: input.category ?? null,
        question: input.question,
        answer: input.answer,
        displayOrder,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FAQS",
      action: "FAQ_CREATED",
      description: `FAQ "${faq.question}" was created.`,
      recordType: "Faq",
      recordId: faq.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return faq;
  });
}

export async function updateFaq(
  actorUserId: string,
  faqId: string,
  input: UpdateFaqInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.faq.findUnique({ where: { id: faqId } });

    if (!existing) {
      throw new HttpError(404, "FAQ was not found.");
    }

    const data: Prisma.FaqUpdateInput = {};
    if (input.category !== undefined) data.category = input.category;
    if (input.question !== undefined) data.question = input.question;
    if (input.answer !== undefined) data.answer = input.answer;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one FAQ field must be supplied.");
    }

    data.updatedBy = { connect: { id: actorUserId } };

    const faq = await transaction.faq.update({
      where: { id: faqId },
      data,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FAQS",
      action: "FAQ_UPDATED",
      description: `FAQ "${faq.question}" was updated.`,
      recordType: "Faq",
      recordId: faq.id,
      metadata: {
        updatedFields: Object.keys(data).filter((key) => key !== "updatedBy"),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return faq;
  });
}

export async function setFaqPublished(
  actorUserId: string,
  faqId: string,
  isPublished: boolean,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.faq.findUnique({ where: { id: faqId } });

    if (!existing) {
      throw new HttpError(404, "FAQ was not found.");
    }

    if (existing.isPublished === isPublished) {
      throw new HttpError(
        409,
        `This FAQ is already ${isPublished ? "published" : "unpublished"}.`
      );
    }

    const faq = await transaction.faq.update({
      where: { id: faqId },
      data: {
        isPublished,
        updatedByUserId: actorUserId,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FAQS",
      action: isPublished ? "FAQ_PUBLISHED" : "FAQ_UNPUBLISHED",
      description: `FAQ "${faq.question}" was ${isPublished ? "published" : "unpublished"}.`,
      recordType: "Faq",
      recordId: faq.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return faq;
  });
}

/*
 * Reordering: the request is the full desired order (a list of FAQ IDs);
 * displayOrder becomes each ID's position in that list. Every existing
 * FAQ must appear exactly once so no entry is silently orphaned.
 */
export async function reorderFaqs(
  actorUserId: string,
  orderedFaqIds: string[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const allFaqs = await transaction.faq.findMany({ select: { id: true } });

    const uniqueIds = new Set(orderedFaqIds);

    if (
      uniqueIds.size !== orderedFaqIds.length ||
      allFaqs.length !== orderedFaqIds.length ||
      !allFaqs.every((faq) => uniqueIds.has(faq.id))
    ) {
      throw new HttpError(
        400,
        "The reorder list must contain every FAQ ID exactly once."
      );
    }

    for (const [index, faqId] of orderedFaqIds.entries()) {
      await transaction.faq.update({
        where: { id: faqId },
        data: {
          displayOrder: index + 1,
          updatedByUserId: actorUserId,
        },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FAQS",
      action: "FAQ_REORDERED",
      description: `${orderedFaqIds.length} FAQs were reordered.`,
      metadata: { orderedFaqIds },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.faq.findMany({
      include: {
        createdBy: { select: { id: true, email: true } },
        updatedBy: { select: { id: true, email: true } },
      },
      orderBy: { displayOrder: "asc" },
    });
  });
}

export async function deleteFaq(
  actorUserId: string,
  faqId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.faq.findUnique({ where: { id: faqId } });

    if (!existing) {
      throw new HttpError(404, "FAQ was not found.");
    }

    await transaction.faq.delete({ where: { id: faqId } });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FAQS",
      action: "FAQ_DELETED",
      description: `FAQ "${existing.question}" was deleted.`,
      recordType: "Faq",
      recordId: existing.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return existing;
  });
}
