/*
 * Farmer seminar endpoints. Shapes mirror the backend responses field for
 * field (back end/src/modules/seminars). Quiz answers never reach the
 * browser — scoring is entirely server-side.
 */
import { api, apiFetchBlob } from "../api";

/* GET /api/seminars/modules -> data[n] (published, farmer view). */
export interface ApiSeminarVideo {
  id: string;
  title: string;
  /** Null on modules this farmer cannot access yet — the backend strips
   *  locked content (prerequisite incomplete or paid module not owned). */
  videoUrl: string | null;
  description: string | null;
  displayOrder: number;
  durationSeconds: number | null;
  fileName: string | null;
}

export interface ApiSeminarModule {
  id: string;
  moduleNumber: number;
  title: string;
  description: string | null;
  /** Card artwork uploaded by staff in the admin module editor. */
  coverImageUrl: string | null;
  passingScore: number;
  /** Access price (Prisma Decimal as string); "0" = free module. */
  price: string;
  isPublished: boolean;
  videos: ApiSeminarVideo[];
  _count: { questions: number };
}

/* GET /api/seminars/me/progress -> data.modules[n] */
export interface ApiQuizAttemptSummary {
  id: string;
  score: number;
  totalScore: number;
  percentage: string | number;
  passed: boolean;
  createdAt: string;
}

/** Where a paid module's purchase stands (free modules: NOT_REQUIRED). */
export type ApiSeminarPurchaseStatus =
  | "NOT_REQUIRED"
  | "NOT_PURCHASED"
  | "PENDING"
  | "OWNED";

export interface ApiModuleProgress {
  moduleId: string;
  moduleNumber: number;
  title: string;
  passingScore: number;
  started: boolean;
  startedAt: string | null;
  completedAt: string | null;
  totalVideos: number;
  completedVideos: number;
  quizAttemptCount: number;
  quizPassed: boolean;
  bestAttempt: ApiQuizAttemptSummary | null;
  /*
   * Pricing + purchase-gated access, computed server-side with the same
   * rule the content APIs enforce:
   *   accessible = prerequisiteCompleted && (free || OWNED purchase)
   */
  price: string;
  isFree: boolean;
  purchaseStatus: ApiSeminarPurchaseStatus;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  prerequisiteCompleted: boolean;
  prerequisiteModuleNumber: number | null;
  accessible: boolean;
  /** Persistent enrollment completion (videos + a passing attempt). */
  completed: boolean;
  /** The module is finished and its exam is closed for the 2-year cycle. */
  retakeLocked: boolean;
}

/*
 * The account's seminar cycle, decided entirely by the backend: whether
 * Modules 1-3 are done, which Certificate of Attendance that earned, and
 * how long the completion stands. The 2-year window reuses the
 * certificate validity rule — validUntil when staff issued the physical
 * certificate, otherwise two years from the approval that assigned the
 * SEM number.
 */
export interface ApiSeminarCompletionCertificate {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  certificateNumber: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  validUntil: string | null;
  hasCertificateFile: boolean;
  validityStatus: "NOT_ISSUED" | "VALID" | "EXPIRED";
}

export interface ApiSeminarCompletion {
  completedRequiredModules: number;
  requiredModuleNumbers: number[];
  allRequiredCompleted: boolean;
  completedAt: string | null;
  certificate: ApiSeminarCompletionCertificate | null;
  completionValidUntil: string | null;
  completionValidityStatus: "NONE" | "VALID" | "EXPIRED";
  /** Exams stay closed while this is true; it lifts at expiry. */
  retakeLocked: boolean;
}

export interface ApiMyProgress {
  customerNumber: string;
  modules: ApiModuleProgress[];
  completedRequiredModules: number;
  requiredModuleNumbers: number[];
  parentStockUnlocked: boolean;
  seminarCompletion: ApiSeminarCompletion;
}

/* GET /api/seminars/modules/:moduleId/quiz -> data */
export interface ApiQuizChoice {
  id: string;
  choiceText: string;
  displayOrder: number;
}

export interface ApiQuizQuestion {
  id: string;
  questionText: string;
  points: number;
  displayOrder: number;
  choices: ApiQuizChoice[];
}

export interface ApiQuiz {
  id: string;
  moduleNumber: number;
  title: string;
  passingScore: number;
  questions: ApiQuizQuestion[];
}

/* POST quiz -> data */
export interface ApiQuizResult {
  attemptId: string;
  score: number;
  totalScore: number;
  percentage: number;
  passingScore: number;
  passed: boolean;
  moduleCompleted: boolean;
}

/* GET /api/seminars/certificates/me -> data[n] */
export interface ApiCertificateRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedAt: string;
  certificateNumber: string | null;
  /* Approval timestamp (SEM number assignment) — NOT the official
     issuance below; the old composite certificate page shows it. */
  certificateIssuedAt: string | null;
  reviewNotes: string | null;
  /*
   * Issued-certificate workflow: staff upload the physical certificate
   * file and then explicitly ISSUE it. Only issuedAt starts the 2-year
   * validity window (validUntil = issuedAt + 2 years); validityStatus
   * is derived server-side from validUntil so expiry is automatic.
   */
  hasCertificateFile: boolean;
  certificateFileName: string | null;
  certificateFileMimeType: string | null;
  fileUploadedAt: string | null;
  issuedAt: string | null;
  validUntil: string | null;
  validityStatus: "NOT_ISSUED" | "VALID" | "EXPIRED";
}

export async function listSeminarModules(): Promise<ApiSeminarModule[]> {
  const response = await api.get<{ data: ApiSeminarModule[] }>(
    "/api/seminars/modules"
  );
  return response.data;
}

export async function getMyProgress(): Promise<ApiMyProgress> {
  const response = await api.get<{ data: ApiMyProgress }>(
    "/api/seminars/me/progress"
  );
  return response.data;
}

export async function startModule(moduleId: string): Promise<void> {
  await api.post(`/api/seminars/modules/${moduleId}/start`);
}

export async function reportVideoProgress(
  videoId: string,
  progressPercent: number
): Promise<{ moduleCompleted: boolean }> {
  const response = await api.patch<{ moduleCompleted: boolean }>(
    `/api/seminars/videos/${videoId}/progress`,
    { progressPercent }
  );
  return { moduleCompleted: response.moduleCompleted };
}

export async function getModuleQuiz(moduleId: string): Promise<ApiQuiz> {
  const response = await api.get<{ data: ApiQuiz }>(
    `/api/seminars/modules/${moduleId}/quiz`
  );
  return response.data;
}

export async function submitModuleQuiz(
  moduleId: string,
  answers: Array<{ questionId: string; choiceId: string }>
): Promise<ApiQuizResult> {
  const response = await api.post<{ data: ApiQuizResult }>(
    `/api/seminars/modules/${moduleId}/quiz`,
    { answers }
  );
  return response.data;
}

export async function requestCertificate(): Promise<ApiCertificateRequest> {
  const response = await api.post<{ data: ApiCertificateRequest }>(
    "/api/seminars/certificates/request"
  );
  return response.data;
}

export async function listMyCertificateRequests(): Promise<
  ApiCertificateRequest[]
> {
  const response = await api.get<{ data: ApiCertificateRequest[] }>(
    "/api/seminars/certificates/me"
  );
  return response.data;
}

/*
 * The actual certificate file staff uploaded and issued for THIS
 * account. The backend only serves the caller's own issued
 * certificates — a foreign or unissued ID responds 404.
 */
export async function fetchMyCertificateFile(requestId: string): Promise<Blob> {
  return apiFetchBlob(`/api/seminars/certificates/me/${requestId}/file`);
}
