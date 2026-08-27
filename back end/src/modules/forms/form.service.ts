import { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

/*
 * Persisted admin form-builder definitions (Requirement: Forms). A
 * form's content is its ordered field rows; the builder always saves
 * the whole definition, so a field update is a full replace inside one
 * transaction. Submissions (future customer-site work) RESTRICT the
 * form row, which is what lets DELETE decide between a true delete and
 * an archive.
 */

export interface FormFieldInput {
  fieldType: string;
  label: string;
  required?: boolean;
  placeholder?: string | null;
  allowOther?: boolean;
  timeFormat?: string | null;
  options?: string[] | null;
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: FormFieldInput[];
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  fields?: FormFieldInput[];
}

const FORM_INCLUDE = {
  fields: { orderBy: { displayOrder: "asc" as const } },
  createdBy: { select: { id: true, email: true } },
  updatedBy: { select: { id: true, email: true } },
  _count: { select: { submissions: true } },
};

function toFieldRows(fields: FormFieldInput[]) {
  return fields.map((field, index) => ({
    fieldType: field.fieldType,
    label: field.label,
    displayOrder: index + 1,
    required: field.required ?? false,
    placeholder: field.placeholder ?? null,
    allowOther: field.allowOther ?? false,
    timeFormat: field.timeFormat ?? null,
    options:
      field.options === undefined || field.options === null
        ? Prisma.JsonNull
        : (field.options as Prisma.InputJsonValue),
  }));
}

export async function getForms(includeArchived: boolean) {
  return prisma.form.findMany({
    where: includeArchived ? undefined : { archivedAt: null },
    include: FORM_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export async function getFormById(formId: string) {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    include: FORM_INCLUDE,
  });

  if (!form) {
    throw new HttpError(404, "Form was not found.");
  }

  return form;
}

export async function createForm(
  actorUserId: string,
  input: CreateFormInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const form = await transaction.form.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        fields: { create: toFieldRows(input.fields) },
      },
      include: FORM_INCLUDE,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FORMS",
      action: "FORM_CREATED",
      description: `Form "${form.name}" was created with ${form.fields.length} field(s).`,
      recordType: "Form",
      recordId: form.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return form;
  });
}

export async function updateForm(
  actorUserId: string,
  formId: string,
  input: UpdateFormInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.form.findUnique({
      where: { id: formId },
    });

    if (!existing) {
      throw new HttpError(404, "Form was not found.");
    }

    if (existing.archivedAt) {
      throw new HttpError(409, "An archived form cannot be edited.");
    }

    const data: Prisma.FormUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;

    if (
      Object.keys(data).length === 0 &&
      input.fields === undefined
    ) {
      throw new HttpError(400, "At least one form field must be supplied.");
    }

    // The builder saves whole definitions: replacing the field rows in
    // the same transaction keeps a definition from ever being half-old.
    if (input.fields !== undefined) {
      await transaction.formField.deleteMany({ where: { formId } });
      data.fields = { create: toFieldRows(input.fields) };
    }

    data.updatedBy = { connect: { id: actorUserId } };

    const form = await transaction.form.update({
      where: { id: formId },
      data,
      include: FORM_INCLUDE,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FORMS",
      action: "FORM_UPDATED",
      description: `Form "${form.name}" was updated.`,
      recordType: "Form",
      recordId: form.id,
      metadata: {
        updatedFields: [
          ...Object.keys(data).filter(
            (key) => key !== "updatedBy" && key !== "fields"
          ),
          ...(input.fields !== undefined ? ["fields"] : []),
        ],
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return form;
  });
}

export async function setFormPublished(
  actorUserId: string,
  formId: string,
  isPublished: boolean,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.form.findUnique({
      where: { id: formId },
    });

    if (!existing) {
      throw new HttpError(404, "Form was not found.");
    }

    if (existing.archivedAt) {
      throw new HttpError(409, "An archived form cannot be published.");
    }

    if (existing.isPublished === isPublished) {
      throw new HttpError(
        409,
        `This form is already ${isPublished ? "published" : "unpublished"}.`
      );
    }

    const form = await transaction.form.update({
      where: { id: formId },
      data: { isPublished, updatedByUserId: actorUserId },
      include: FORM_INCLUDE,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FORMS",
      action: isPublished ? "FORM_PUBLISHED" : "FORM_UNPUBLISHED",
      description: `Form "${form.name}" was ${isPublished ? "published" : "unpublished"}.`,
      recordType: "Form",
      recordId: form.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return form;
  });
}

/*
 * DELETE decides by history: a never-submitted form is removed for real
 * (fields cascade with the row); a form with submissions is archived so
 * customer-entered data survives. Repeating the delete on an archived
 * form is a 409 — there is nothing further to remove.
 */
export async function deleteForm(
  actorUserId: string,
  formId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.form.findUnique({
      where: { id: formId },
    });

    if (!existing) {
      throw new HttpError(404, "Form was not found.");
    }

    const submissionCount = await transaction.formSubmission.count({
      where: { formId },
    });

    if (submissionCount === 0) {
      await transaction.form.delete({ where: { id: formId } });

      await recordActivity(transaction, {
        userId: actorUserId,
        module: "FORMS",
        action: "FORM_DELETED",
        description: `Form "${existing.name}" was permanently deleted (no submissions).`,
        recordType: "Form",
        recordId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return { result: "DELETED" as const, form: existing, submissionCount };
    }

    if (existing.archivedAt) {
      throw new HttpError(409, "This form is already archived.");
    }

    const archived = await transaction.form.update({
      where: { id: formId },
      data: {
        archivedAt: new Date(),
        isPublished: false,
        updatedByUserId: actorUserId,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "FORMS",
      action: "FORM_ARCHIVED",
      description: `Form "${existing.name}" was archived instead of deleted (${submissionCount} submission(s) preserved).`,
      recordType: "Form",
      recordId: existing.id,
      metadata: { submissionCount },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { result: "ARCHIVED" as const, form: archived, submissionCount };
  });
}
