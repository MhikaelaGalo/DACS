import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  createFaq,
  deleteFaq,
  getAllFaqs,
  getPublishedFaqs,
  reorderFaqs,
  setFaqPublished,
  updateFaq,
  type UpdateFaqInput,
} from "./faq.service";

const FAQ_FIELDS = ["category", "question", "answer", "displayOrder"] as const;

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

function optionalDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(
      400,
      "Display order must be a positive whole number.",
      "displayOrder"
    );
  }

  return value;
}

function queryFilters(request: Request) {
  return {
    category:
      typeof request.query.category === "string"
        ? request.query.category
        : undefined,
    search:
      typeof request.query.search === "string"
        ? request.query.search
        : undefined,
  };
}

/*
 * Public: no authentication — this list backs the website's FAQ page.
 */
export async function listPublishedFaqs(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const faqs = await getPublishedFaqs(queryFilters(request));

    response.json({
      success: true,
      count: faqs.length,
      data: faqs,
    });
  } catch (error) {
    next(error);
  }
}

export async function listAllFaqs(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    let isPublished: boolean | undefined;

    if (request.query.isPublished !== undefined) {
      if (
        request.query.isPublished !== "true" &&
        request.query.isPublished !== "false"
      ) {
        throw new HttpError(400, "isPublished must be true or false.");
      }
      isPublished = request.query.isPublished === "true";
    }

    const faqs = await getAllFaqs({ ...queryFilters(request), isPublished });

    response.json({
      success: true,
      count: faqs.length,
      data: faqs,
    });
  } catch (error) {
    next(error);
  }
}

export async function createNewFaq(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, FAQ_FIELDS);

    const faq = await createFaq(
      actor.id,
      {
        category: optionalString(raw.category, "Category", 100),
        question: requiredString(raw.question, "Question", 300),
        answer: requiredString(raw.answer, "Answer", 3000),
        displayOrder: optionalDisplayOrder(raw.displayOrder),
      },
      requestMeta(request)
    );

    response.status(201).json({
      success: true,
      message: "FAQ was created successfully.",
      data: faq,
    });
  } catch (error) {
    next(error);
  }
}

export async function editFaq(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const faqId = requiredUuid(request.params.faqId, "The FAQ ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, FAQ_FIELDS);

    const input: UpdateFaqInput = {};

    if (raw.category !== undefined) {
      input.category = optionalString(raw.category, "Category", 100);
    }

    if (raw.question !== undefined) {
      input.question = requiredString(raw.question, "Question", 300);
    }

    if (raw.answer !== undefined) {
      input.answer = requiredString(raw.answer, "Answer", 3000);
    }

    if (raw.displayOrder !== undefined) {
      input.displayOrder = optionalDisplayOrder(raw.displayOrder);
    }

    const faq = await updateFaq(actor.id, faqId, input, requestMeta(request));

    response.json({
      success: true,
      message: "FAQ was updated successfully.",
      data: faq,
    });
  } catch (error) {
    next(error);
  }
}

export async function publishFaq(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const faqId = requiredUuid(request.params.faqId, "The FAQ ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["isPublished"]);

    if (typeof raw.isPublished !== "boolean") {
      throw new HttpError(400, "isPublished must be true or false.");
    }

    const faq = await setFaqPublished(
      actor.id,
      faqId,
      raw.isPublished,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: `FAQ was ${raw.isPublished ? "published" : "unpublished"} successfully.`,
      data: faq,
    });
  } catch (error) {
    next(error);
  }
}

export async function reorderAllFaqs(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["orderedFaqIds"]);

    if (!Array.isArray(raw.orderedFaqIds) || raw.orderedFaqIds.length === 0) {
      throw new HttpError(
        400,
        "orderedFaqIds must be a list of FAQ IDs.",
        "orderedFaqIds"
      );
    }

    const orderedFaqIds = raw.orderedFaqIds.map((value) =>
      requiredUuid(value, "Every entry in orderedFaqIds")
    );

    const faqs = await reorderFaqs(actor.id, orderedFaqIds, requestMeta(request));

    response.json({
      success: true,
      message: "FAQs were reordered successfully.",
      count: faqs.length,
      data: faqs,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeFaq(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const faqId = requiredUuid(request.params.faqId, "The FAQ ID");
    const faq = await deleteFaq(actor.id, faqId, requestMeta(request));

    response.json({
      success: true,
      message: "FAQ was deleted successfully.",
      data: faq,
    });
  } catch (error) {
    next(error);
  }
}
