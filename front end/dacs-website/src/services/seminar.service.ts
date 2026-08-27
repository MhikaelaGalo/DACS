/*
 * Seminar view-model over the DACS backend: the published modules
 * (GET /api/seminars/modules) joined with this farmer's progress
 * (GET /api/seminars/me/progress). Enrollment, video progress and quiz
 * scoring all happen server-side — the only client-side state left is
 * the active-module UI pointer and the sequential Module 1 -> 2 -> 3
 * unlock rule (a UX rule; the backend enforces the all-three gate on
 * Parent Stock ordering and certificates).
 */
import { ApiError } from "@/lib/api";
import {
  getMyProgress,
  listSeminarModules,
  startModule,
  type ApiModuleProgress,
  type ApiSeminarCompletion,
  type ApiSeminarModule,
  type ApiSeminarPurchaseStatus,
} from "@/lib/api/seminars";
import {
  readUserStorage,
  USER_STORAGE_KEYS,
  writeUserStorage,
} from "@/lib/storage/local-storage";
import type { SeminarStatus } from "@/constants/statuses";

/** Stable per-module id ("module-<number>") used by routes and storage. */
export type SeminarSequenceId = `module-${number}`;

/**
 * The REQUIRED modules a farmer must complete before chick ordering
 * (mirrors the backend's Parent Stock gate). Additional published
 * modules beyond these appear in the catalog but are not required.
 */
export const SEMINAR_SEQUENCE: readonly SeminarSequenceId[] = [
  "module-1",
  "module-2",
  "module-3",
];

export const SEMINAR_SPEAKER = "Dr. Erwin Joseph Cruz";

export interface SeminarVideoView {
  /** Backend video UUID (used for progress reporting). */
  id: string;
  number: number;
  title: string;
  description: string;
  videoUrl: string;
  durationLabel: string;
  watched: boolean;
}

export interface SeminarView {
  /** Stable sequence id ("module-N") used by routes and the unlock rule. */
  id: SeminarSequenceId;
  /** Backend module UUID (used for start/quiz calls). */
  moduleId: string;
  moduleNumber: number;
  title: string;
  description: string;
  /** Staff-uploaded card artwork (admin module editor); null = no cover
   *  yet, and the card shows its neutral placeholder. */
  imageUrl: string | null;
  durationLabel: string;
  speaker: string;
  videos: SeminarVideoView[];
  questionCount: number;
  passingScore: number;
  /** Enrollment exists on the backend. */
  started: boolean;
  status: SeminarStatus;
  examPassed: boolean;
  completedAt?: string;
  bestScorePercent?: number;
  quizAttemptCount: number;
  totalVideos: number;
  completedVideos: number;
  /* ---- Pricing + purchase-gated access (backend-computed) ---- */
  /** Access price in pesos; 0 = free. */
  price: number;
  /** "Free" or "₱2,700" — ready for the card. */
  priceLabel: string;
  isFree: boolean;
  purchaseStatus: ApiSeminarPurchaseStatus;
  purchaseOrderNumber: string | null;
  prerequisiteCompleted: boolean;
  prerequisiteModuleNumber: number | null;
  /** The backend's own access verdict:
   *  prerequisiteCompleted && (free || purchase OWNED). */
  accessible: boolean;
  /** Persistent completion record (videos watched + a passing attempt) —
   *  NOT the latest attempt, so it survives refresh/logout/new device. */
  completed: boolean;
  /** Finished module whose exam is closed for the 2-year cycle (the
   *  backend's quiz endpoints enforce the same verdict). */
  retakeLocked: boolean;
}

/** The account's seminar cycle exactly as the backend reports it. */
export type SeminarCompletion = ApiSeminarCompletion;

/** No progress payload yet (account without a customer profile). */
const EMPTY_COMPLETION: SeminarCompletion = {
  completedRequiredModules: 0,
  requiredModuleNumbers: [1, 2, 3],
  allRequiredCompleted: false,
  completedAt: null,
  certificate: null,
  completionValidUntil: null,
  completionValidityStatus: "NONE",
  retakeLocked: false,
};

/** "Free" for 0, otherwise "₱2,700"-style pesos (centavos only if set). */
export function formatPriceLabel(price: number): string {
  if (price <= 0) return "Free";
  return `₱${price.toLocaleString("en-PH", {
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function totalDurationLabel(module: ApiSeminarModule): string {
  const total = module.videos.reduce(
    (sum, video) => sum + (video.durationSeconds ?? 0),
    0
  );
  return formatDuration(total) || "Self-paced";
}

/*
 * Fallback access facts for accounts with no progress payload yet (no
 * customer profile): nothing completed, nothing purchased — only the
 * first free module is accessible.
 */
interface FallbackAccess {
  allPreviousCompleted: boolean;
  previousModuleNumber: number | null;
}

function toView(
  module: ApiSeminarModule,
  progress: ApiModuleProgress | undefined,
  fallback: FallbackAccess
): SeminarView {
  const completedVideos = progress?.completedVideos ?? 0;
  const started = progress?.started ?? false;
  const examPassed = progress?.quizPassed ?? false;
  const completed = progress?.completedAt != null;
  /*
   * The backend reports how many videos hit 100%, not which ones; the
   * player enforces watch order, so the first N videos are the watched
   * ones. Locked modules arrive with their video URLs stripped ("" here);
   * the module page never plays them because access is denied first.
   */
  const videos: SeminarVideoView[] = module.videos.map((video, index) => ({
    id: video.id,
    number: index + 1,
    title: video.title,
    description: video.description ?? "",
    videoUrl: video.videoUrl ?? "",
    durationLabel: formatDuration(video.durationSeconds),
    watched: index < completedVideos,
  }));

  const price = Number(module.price ?? 0);
  const isFree = progress?.isFree ?? price <= 0;
  const purchaseStatus =
    progress?.purchaseStatus ?? (isFree ? "NOT_REQUIRED" : "NOT_PURCHASED");
  const prerequisiteCompleted =
    progress?.prerequisiteCompleted ?? fallback.allPreviousCompleted;
  const accessible =
    progress?.accessible ??
    (prerequisiteCompleted && (isFree || purchaseStatus === "OWNED"));

  return {
    id: `module-${module.moduleNumber}` as SeminarSequenceId,
    moduleId: module.id,
    moduleNumber: module.moduleNumber,
    title: module.title,
    description: module.description ?? "",
    imageUrl: module.coverImageUrl,
    durationLabel: totalDurationLabel(module),
    speaker: SEMINAR_SPEAKER,
    videos,
    questionCount: module._count.questions,
    passingScore: module.passingScore,
    started,
    status: completed ? "Completed" : started ? "In Progress" : "Not Started",
    examPassed,
    completedAt: progress?.completedAt ?? undefined,
    bestScorePercent:
      progress?.bestAttempt != null
        ? Math.round(Number(progress.bestAttempt.percentage))
        : undefined,
    quizAttemptCount: progress?.quizAttemptCount ?? 0,
    totalVideos: progress?.totalVideos ?? module.videos.length,
    completedVideos,
    price,
    priceLabel: formatPriceLabel(price),
    isFree,
    purchaseStatus,
    purchaseOrderNumber: progress?.purchaseOrderNumber ?? null,
    prerequisiteCompleted,
    prerequisiteModuleNumber:
      progress?.prerequisiteModuleNumber ?? fallback.previousModuleNumber,
    accessible,
    completed: progress?.completed ?? completed,
    retakeLocked: progress?.retakeLocked ?? false,
  };
}

/**
 * EVERY published module as combined module + progress views, ordered by
 * module number — newly published modules appear here automatically.
 * Farmers without a customer profile yet simply have no progress (404
 * tolerated).
 */
export async function fetchSeminarViews(): Promise<SeminarView[]> {
  return (await fetchSeminarState()).views;
}

/**
 * The module views PLUS the account's seminar-cycle record, from the one
 * progress call that already carries both. Pages that must know whether
 * the whole seminar is finished (the certificate page, the exam guard,
 * the catalog's completed state) read this instead of inferring
 * completion from the active module's latest exam attempt.
 */
export interface SeminarState {
  views: SeminarView[];
  completion: SeminarCompletion;
}

export async function fetchSeminarState(): Promise<SeminarState> {
  /*
   * The catalog and this farmer's progress are independent requests, so
   * they go out together — awaiting one before the other made every
   * seminar page wait for the sum of two round-trips instead of the
   * slower one. A missing customer profile (404) still degrades to "no
   * progress" without failing the catalog.
   */
  const [modules, progress] = await Promise.all([
    listSeminarModules(),
    getMyProgress().catch((error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      return null;
    }),
  ]);

  let progressByNumber = new Map<number, ApiModuleProgress>();
  let completion: SeminarCompletion = EMPTY_COMPLETION;
  if (progress) {
    progressByNumber = new Map(
      progress.modules.map((entry) => [entry.moduleNumber, entry])
    );
    completion = progress.seminarCompletion ?? EMPTY_COMPLETION;
  }

  // Cumulative fallback for profiles the backend has no progress for.
  let allPreviousCompleted = true;
  let previousModuleNumber: number | null = null;

  const views = modules
    .slice()
    .sort((a, b) => a.moduleNumber - b.moduleNumber)
    .map((module) => {
      const view = toView(module, progressByNumber.get(module.moduleNumber), {
        allPreviousCompleted,
        previousModuleNumber,
      });
      allPreviousCompleted =
        allPreviousCompleted && view.status === "Completed";
      previousModuleNumber = module.moduleNumber;
      return view;
    });

  return { views, completion };
}

/**
 * May the farmer OPEN this module's content right now? This is the
 * backend's own verdict (the content APIs enforce the same rule):
 * every published module before it completed, and — for paid modules —
 * a staff-verified purchase.
 */
export function canAccessView(view: SeminarView): boolean {
  return view.accessible;
}

/** Enrolls (idempotently) before entering a module the farmer may access
 *  but has not formally registered for (e.g. right after purchase). */
export async function ensureStarted(view: SeminarView): Promise<void> {
  if (!view.started) await startModule(view.moduleId);
}

/**
 * Why a module cannot be opened yet, in customer words (spec: locked
 * cards must explain themselves). Returns undefined for accessible views.
 */
export function lockReasonFor(view: SeminarView): string | undefined {
  if (view.accessible) return undefined;

  const previousLabel =
    view.prerequisiteModuleNumber !== null
      ? `Module ${view.prerequisiteModuleNumber}`
      : "the previous module";
  const needsPurchase =
    !view.isFree &&
    view.purchaseStatus !== "OWNED" &&
    view.purchaseStatus !== "PENDING";

  if (!view.prerequisiteCompleted && needsPurchase) {
    return `Complete ${previousLabel} and purchase this module (${view.priceLabel}) to continue.`;
  }
  if (!view.prerequisiteCompleted) {
    return `Complete ${previousLabel} first.`;
  }
  if (view.purchaseStatus === "PENDING") {
    return "Payment awaiting DACS approval.";
  }
  return `Purchase required — ${view.priceLabel}.`;
}

/** Enrolls (idempotently) in each selected module on the backend. */
export async function enrollInModules(views: SeminarView[]): Promise<void> {
  for (const view of views) {
    await startModule(view.moduleId);
  }
}

/* ------------------------------------------------------------------ */
/* Active-module UI pointer (client-side navigation state only)        */
/* ------------------------------------------------------------------ */

const ACTIVE_SEMINAR_KEY = USER_STORAGE_KEYS.activeSeminarId;

/** Explicitly selects which seminar's Videos → Exam → Certificate flow is open. */
export function setActiveSeminarId(seminarId: string): void {
  writeUserStorage(ACTIVE_SEMINAR_KEY, seminarId);
}

export function getActiveSeminarId(): SeminarSequenceId | null {
  const stored = readUserStorage<string | null>(ACTIVE_SEMINAR_KEY, null);
  return stored !== null && /^module-\d+$/.test(stored)
    ? (stored as SeminarSequenceId)
    : null;
}

/** The view whose flow is open: the explicitly selected one, else the
 *  first started-but-incomplete module, else Module 1. */
export function pickActiveView(views: SeminarView[]): SeminarView | null {
  if (views.length === 0) return null;
  const storedId = getActiveSeminarId();
  return (
    views.find((view) => view.id === storedId) ??
    views.find((view) => view.started && !view.examPassed) ??
    views[0]
  );
}

/* ------------------------------------------------------------------ */
/* Module completion vs. SEMINAR completion                            */
/* ------------------------------------------------------------------ */

/*
 * There is ONE Certificate of Attendance, and it belongs to the whole
 * required sequence — not to each module that happens to be finished.
 * Two different questions, deliberately kept apart:
 *
 *   view.completed              — this module is done (badge, next step)
 *   completion.allRequiredCompleted — the SEMINAR is done (certificate)
 *
 * Certificate actions need BOTH: the account has finished every required
 * module, AND the module being looked at is where the sequence ends.
 * Finishing Module 1 or 2 never earns or reveals a certificate.
 */

/** The last module of the required sequence (Module 3 today). */
export function finalRequiredModuleNumber(
  completion: SeminarCompletion
): number | null {
  const required = completion.requiredModuleNumbers;
  return required.length > 0 ? Math.max(...required) : null;
}

/** Is this the module that ends the required sequence? */
export function isFinalRequiredModule(
  view: SeminarView,
  completion: SeminarCompletion
): boolean {
  return view.moduleNumber === finalRequiredModuleNumber(completion);
}

/**
 * May the Certificate of Attendance be offered on this module's
 * completion view? Only where the sequence ends, and only once the
 * backend confirms every required module is complete.
 */
export function certificateAvailableOn(
  view: SeminarView,
  completion: SeminarCompletion
): boolean {
  return completion.allRequiredCompleted && isFinalRequiredModule(view, completion);
}

/** The module after this one in catalog order, if the catalog has one. */
export function nextModuleAfter(
  views: SeminarView[],
  view: SeminarView
): SeminarView | null {
  const index = views.findIndex((entry) => entry.id === view.id);
  if (index < 0) return null;
  return views[index + 1] ?? null;
}
