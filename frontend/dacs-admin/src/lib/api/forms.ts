/*
 * Forms endpoints (staff: Owner + Administrative Staff). Mirrors
 * back end/src/modules/forms.
 *
 * Wire asymmetry: requests send each field's kind as `type`, responses
 * return it as `fieldType`. Field rows are replaced wholesale on every
 * save (ids churn), and `options` is only legal on dropdown/choice
 * fields while `timeFormat` is only legal on time fields — the mappers
 * below enforce both.
 */
import { api } from "../api";
import type { FormBlock, FormDefinition, FormFieldType } from "@/types/admin";

export interface ApiFormField {
  id: string;
  formId: string;
  fieldType: string;
  label: string;
  displayOrder: number;
  required: boolean;
  placeholder: string | null;
  allowOther: boolean;
  timeFormat: string | null;
  options: string[] | null;
  createdAt: string;
}

export interface ApiForm {
  id: string;
  name: string;
  description: string | null;
  isPublished: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  fields: ApiFormField[];
  createdBy: { id: string; email: string } | null;
  updatedBy: { id: string; email: string } | null;
  _count?: { submissions: number };
}

export function toFormDefinition(form: ApiForm): FormDefinition {
  return {
    id: form.id,
    name: form.name,
    description: form.description ?? "",
    isPublished: form.isPublished,
    blocks: form.fields.map((field) => ({
      id: field.id,
      type: field.fieldType as FormFieldType,
      label: field.label,
      options: field.options ?? undefined,
      required: field.required,
      placeholder: field.placeholder ?? undefined,
      allowOther: field.allowOther,
      timeFormat:
        field.timeFormat === "12-hour" || field.timeFormat === "24-hour"
          ? field.timeFormat
          : undefined,
    })),
  };
}

/* Request-shape field objects; order = array position (server rule). */
export function toWireFields(blocks: FormBlock[]): Array<Record<string, unknown>> {
  return blocks.map((block) => ({
    type: block.type,
    label: block.label,
    ...(block.type === "dropdown" || block.type === "choice"
      ? { options: block.options ?? [] }
      : {}),
    ...(block.required !== undefined ? { required: block.required } : {}),
    ...(block.placeholder ? { placeholder: block.placeholder } : {}),
    ...(block.allowOther !== undefined ? { allowOther: block.allowOther } : {}),
    ...(block.type === "time" && block.timeFormat
      ? { timeFormat: block.timeFormat }
      : {}),
  }));
}

export async function listForms(): Promise<ApiForm[]> {
  const response = await api.get<{ data: ApiForm[] }>("/api/forms");
  return response.data;
}

export async function getForm(formId: string): Promise<ApiForm> {
  const response = await api.get<{ data: ApiForm }>(`/api/forms/${formId}`);
  return response.data;
}

export async function createForm(input: {
  name: string;
  description?: string | null;
  fields?: Array<Record<string, unknown>>;
}): Promise<ApiForm> {
  const response = await api.post<{ data: ApiForm }>("/api/forms", input);
  return response.data;
}

export async function updateForm(
  formId: string,
  input: {
    name?: string;
    description?: string | null;
    fields?: Array<Record<string, unknown>>;
  }
): Promise<ApiForm> {
  const response = await api.patch<{ data: ApiForm }>(
    `/api/forms/${formId}`,
    input
  );
  return response.data;
}

export async function publishForm(
  formId: string,
  isPublished: boolean
): Promise<ApiForm> {
  const response = await api.patch<{ data: ApiForm }>(
    `/api/forms/${formId}/publish`,
    { isPublished }
  );
  return response.data;
}

export async function deleteForm(formId: string): Promise<{
  result: "DELETED" | "ARCHIVED";
  submissionCount: number;
}> {
  const response = await api.del<{
    data: { result: "DELETED" | "ARCHIVED"; submissionCount: number };
  }>(`/api/forms/${formId}`);
  return response.data;
}
