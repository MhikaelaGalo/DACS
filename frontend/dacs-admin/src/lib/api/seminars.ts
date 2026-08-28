/*
 * Seminar Management endpoints (staff: Owner + Administrative Staff).
 * Mirrors back end/src/modules/seminars.
 */
import { api, apiFetchBlob } from "../api";

export interface ApiSeminarVideo {
  id: string;
  title: string;
  videoUrl: string;
  description: string | null;
  displayOrder: number;
  durationSeconds: number | null;
  fileName: string | null;
}

export interface ApiSeminarChoice {
  id: string;
  questionId?: string;
  choiceText: string;
  isCorrect: boolean;
  displayOrder: number;
}

export interface ApiSeminarQuestion {
  id: string;
  questionText: string;
  points: number;
  displayOrder: number;
  isActive: boolean;
  choices: ApiSeminarChoice[];
}

export interface ApiSeminarModule {
  id: string;
  moduleNumber: number;
  title: string;
  description: string | null;
  passingScore: number;
  /** Access price (Prisma Decimal as string); "0" = free module. */
  price: string;
  isPublished: boolean;
  hasUnpublishedChanges: boolean;
  archivedAt: string | null;
  certificateTemplateUrl: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  videos: ApiSeminarVideo[];
  questions?: ApiSeminarQuestion[];
  _count?: { questions: number };
}

/* "mm:ss" (minutes may exceed 59, matching the existing UI). */
export function formatDuration(durationSeconds: number | null): string {
  if (!durationSeconds || durationSeconds <= 0) return "00:00";
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/* Accepts "ss", "mm:ss" or "hh:mm:ss"; null when unparseable. */
export function parseDuration(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  const total = parts.reduce((sum, part) => sum * 60 + part, 0);
  return Number.isInteger(total) && total > 0 ? total : null;
}

export async function listSeminarModules(): Promise<ApiSeminarModule[]> {
  const response = await api.get<{ data: ApiSeminarModule[] }>(
    "/api/seminars/modules"
  );
  return response.data;
}

export async function getSeminarModule(
  moduleId: string
): Promise<ApiSeminarModule> {
  const response = await api.get<{ data: ApiSeminarModule }>(
    `/api/seminars/modules/${moduleId}`
  );
  return response.data;
}

export async function createSeminarModule(input: {
  moduleNumber: number;
  title: string;
  description?: string | null;
  passingScore: number;
  /* Access price in pesos; omitted/0 = free module. */
  price?: number;
}): Promise<ApiSeminarModule> {
  const response = await api.post<{ data: ApiSeminarModule }>(
    "/api/seminars/modules",
    input
  );
  return response.data;
}

export async function updateSeminarModule(
  moduleId: string,
  input: {
    title?: string;
    description?: string | null;
    passingScore?: number;
    isPublished?: boolean;
    price?: number;
  }
): Promise<ApiSeminarModule> {
  const response = await api.patch<{ data: ApiSeminarModule }>(
    `/api/seminars/modules/${moduleId}`,
    input
  );
  return response.data;
}

export async function deleteSeminarModule(moduleId: string): Promise<{
  result: "DELETED" | "ARCHIVED";
  enrollmentCount: number;
}> {
  const response = await api.del<{
    data: { result: "DELETED" | "ARCHIVED"; enrollmentCount: number };
  }>(`/api/seminars/modules/${moduleId}`);
  return response.data;
}

export async function uploadSeminarVideo(
  moduleId: string,
  file: File,
  input: { title: string; durationSeconds?: number | null; displayOrder?: number }
): Promise<ApiSeminarVideo> {
  const formData = new FormData();
  formData.append("video", file);
  formData.append("title", input.title);
  if (input.durationSeconds) {
    formData.append("durationSeconds", String(input.durationSeconds));
  }
  if (input.displayOrder) {
    formData.append("displayOrder", String(input.displayOrder));
  }
  const response = await api.upload<{ data: ApiSeminarVideo }>(
    `/api/seminars/modules/${moduleId}/videos`,
    formData
  );
  return response.data;
}

export async function reorderSeminarVideos(
  moduleId: string,
  orderedVideoIds: string[]
): Promise<ApiSeminarVideo[]> {
  const response = await api.patch<{ data: ApiSeminarVideo[] }>(
    `/api/seminars/modules/${moduleId}/videos/reorder`,
    { orderedVideoIds }
  );
  return response.data;
}

export async function deleteSeminarVideo(
  moduleId: string,
  videoId: string
): Promise<{ result: "DELETED" | "ARCHIVED" }> {
  const response = await api.del<{ data: { result: "DELETED" | "ARCHIVED" } }>(
    `/api/seminars/modules/${moduleId}/videos/${videoId}`
  );
  return response.data;
}

export async function addSeminarQuestion(
  moduleId: string,
  input: {
    questionText: string;
    displayOrder?: number;
    choices: Array<{ choiceText: string; isCorrect: boolean }>;
  }
): Promise<ApiSeminarQuestion> {
  const response = await api.post<{ data: ApiSeminarQuestion }>(
    `/api/seminars/modules/${moduleId}/questions`,
    input
  );
  return response.data;
}

export async function updateSeminarQuestion(
  moduleId: string,
  questionId: string,
  input: {
    questionText?: string;
    choices?: Array<{ id?: string; choiceText: string; isCorrect: boolean }>;
  }
): Promise<ApiSeminarQuestion> {
  const response = await api.patch<{ data: ApiSeminarQuestion }>(
    `/api/seminars/modules/${moduleId}/questions/${questionId}`,
    input
  );
  return response.data;
}

export async function deleteSeminarQuestion(
  moduleId: string,
  questionId: string
): Promise<void> {
  await api.del(`/api/seminars/modules/${moduleId}/questions/${questionId}`);
}

/*
 * Module cover image: the artwork shown on the customer-facing seminar
 * card. PUT replaces the module's single current cover; DELETE removes
 * it (the customer card then falls back to a neutral placeholder).
 */
export async function uploadModuleCoverImage(
  moduleId: string,
  file: File
): Promise<ApiSeminarModule> {
  const formData = new FormData();
  formData.append("image", file);
  const response = await api.upload<{ data: ApiSeminarModule }>(
    `/api/seminars/modules/${moduleId}/cover-image`,
    formData,
    "PUT"
  );
  return response.data;
}

export async function removeModuleCoverImage(
  moduleId: string
): Promise<ApiSeminarModule> {
  const response = await api.del<{ data: ApiSeminarModule }>(
    `/api/seminars/modules/${moduleId}/cover-image`
  );
  return response.data;
}

/*
 * ---------- Certificate files ----------
 *
 * Certificates are generated automatically once Modules 1-3 are
 * complete, so staff never upload, replace or issue one. This reads
 * back a file left by the retired manual workflow; records without one
 * are rendered from the certificate record itself (see lib/certificate).
 */
export async function fetchCertificateFileBlob(
  requestId: string
): Promise<Blob> {
  return apiFetchBlob(`/api/seminars/certificates/${requestId}/file`);
}
