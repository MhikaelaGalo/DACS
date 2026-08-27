import type { NextFunction, Request, Response } from "express";

import { HttpError } from "../../utils/httpError";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  createForm,
  deleteForm,
  getFormById,
  getForms,
  setFormPublished,
  updateForm,
  type FormFieldInput,
  type UpdateFormInput,
} from "./form.service";

const FORM_FIELDS = ["name", "description", "fields"] as const;

/*
 * The admin builder's block types, mirrored server-side as an
 * allowlist. "id" is accepted and ignored — the builder's client-side
 * block ids are replaced by real rows on every save.
 */
const FIELD_TYPES = [
  "title",
  "paragraph",
  "short-answer",
  "file-upload",
  "dropdown",
  "choice",
  "number",
  "checkbox",
  "date",
  "time",
  "button",
  "conditional",
] as const;

const FIELD_KEYS = [
  "id",
  "type",
  "label",
  "options",
  "required",
  "placeholder",
  "allowOther",
  "timeFormat",
] as const;

const OPTION_TYPES = new Set(["dropdown", "choice"]);
const TIME_FORMATS = new Set(["12-hour", "24-hour"]);

const MAX_FIELDS = 100;
const MAX_OPTIONS = 50;

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

function optionalBooleanFlag(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${field} must be true or false.`, field);
  }
  return value;
}

/*
 * One builder block. Labels may be empty (drafts), but every value must
 * be the right shape, options only belong to dropdown/choice fields,
 * and timeFormat only to time fields.
 */
function parseField(raw: unknown, index: number): FormFieldInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HttpError(400, `Field #${index + 1} must be an object.`, "fields");
  }

  const field = raw as Record<string, unknown>;
  rejectUnexpectedFields(field, FIELD_KEYS);

  const fieldType = field.type;
  if (
    typeof fieldType !== "string" ||
    !(FIELD_TYPES as readonly string[]).includes(fieldType)
  ) {
    throw new HttpError(
      400,
      `Field #${index + 1} has an unknown type. Allowed: ${FIELD_TYPES.join(", ")}.`,
      "fields"
    );
  }

  if (typeof field.label !== "string" || field.label.length > 500) {
    throw new HttpError(
      400,
      `Field #${index + 1} needs a text label of at most 500 characters.`,
      "fields"
    );
  }

  let options: string[] | null = null;
  if (field.options !== undefined && field.options !== null) {
    if (!OPTION_TYPES.has(fieldType)) {
      throw new HttpError(
        400,
        `Field #${index + 1}: options are only allowed on dropdown and choice fields.`,
        "fields"
      );
    }
    if (
      !Array.isArray(field.options) ||
      field.options.length > MAX_OPTIONS ||
      field.options.some(
        (option) => typeof option !== "string" || option.length > 200
      )
    ) {
      throw new HttpError(
        400,
        `Field #${index + 1}: options must be a list of at most ${MAX_OPTIONS} texts (200 characters each).`,
        "fields"
      );
    }
    options = field.options as string[];
  }

  let timeFormat: string | null = null;
  if (field.timeFormat !== undefined && field.timeFormat !== null) {
    if (fieldType !== "time" || typeof field.timeFormat !== "string" ||
        !TIME_FORMATS.has(field.timeFormat)) {
      throw new HttpError(
        400,
        `Field #${index + 1}: timeFormat must be "12-hour" or "24-hour" on a time field.`,
        "fields"
      );
    }
    timeFormat = field.timeFormat;
  }

  return {
    fieldType,
    label: field.label,
    required: optionalBooleanFlag(field.required, `Field #${index + 1} required`),
    placeholder: optionalString(
      field.placeholder,
      `Field #${index + 1} placeholder`,
      300
    ),
    allowOther: optionalBooleanFlag(
      field.allowOther,
      `Field #${index + 1} allowOther`
    ),
    timeFormat,
    options,
  };
}

function parseFields(raw: unknown): FormFieldInput[] {
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "fields must be a list of form fields.", "fields");
  }
  if (raw.length > MAX_FIELDS) {
    throw new HttpError(
      400,
      `A form can hold at most ${MAX_FIELDS} fields.`,
      "fields"
    );
  }
  return raw.map((entry, index) => parseField(entry, index));
}

export async function listForms(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const includeArchived = request.query.includeArchived === "true";
    const forms = await getForms(includeArchived);

    response.json({ success: true, data: forms });
  } catch (error) {
    next(error);
  }
}

export async function getForm(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const formId = requiredUuid(request.params.formId, "The form ID");
    const form = await getFormById(formId);

    response.json({ success: true, data: form });
  } catch (error) {
    next(error);
  }
}

export async function postForm(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, FORM_FIELDS);

    const form = await createForm(
      actor.id,
      {
        name: requiredString(raw.name, "Form name", 150),
        description: optionalString(raw.description, "Description", 1000),
        fields: raw.fields === undefined ? [] : parseFields(raw.fields),
      },
      requestMeta(request)
    );

    response.status(201).json({
      success: true,
      message: "Form was created successfully.",
      data: form,
    });
  } catch (error) {
    next(error);
  }
}

export async function patchForm(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const formId = requiredUuid(request.params.formId, "The form ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, FORM_FIELDS);

    const input: UpdateFormInput = {};

    if (raw.name !== undefined) {
      input.name = requiredString(raw.name, "Form name", 150);
    }
    if (raw.description !== undefined) {
      input.description = optionalString(raw.description, "Description", 1000);
    }
    if (raw.fields !== undefined) {
      input.fields = parseFields(raw.fields);
    }

    const form = await updateForm(actor.id, formId, input, requestMeta(request));

    response.json({
      success: true,
      message: "Form was updated successfully.",
      data: form,
    });
  } catch (error) {
    next(error);
  }
}

export async function publishForm(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const formId = requiredUuid(request.params.formId, "The form ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["isPublished"] as const);

    if (typeof raw.isPublished !== "boolean") {
      throw new HttpError(400, "isPublished must be true or false.");
    }

    const form = await setFormPublished(
      actor.id,
      formId,
      raw.isPublished,
      requestMeta(request)
    );

    response.json({
      success: true,
      message: `Form was ${raw.isPublished ? "published" : "unpublished"} successfully.`,
      data: form,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeForm(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const formId = requiredUuid(request.params.formId, "The form ID");

    const outcome = await deleteForm(actor.id, formId, requestMeta(request));

    response.json({
      success: true,
      message:
        outcome.result === "DELETED"
          ? "Form was permanently deleted."
          : `Form was archived instead of deleted because ${outcome.submissionCount} submission(s) reference it.`,
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}
