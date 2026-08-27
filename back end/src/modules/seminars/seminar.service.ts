import { Prisma } from "../../../generated/prisma/client";
import type { OrderStatus } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { resolvePrivateFile } from "../../services/fileStorage.service";
import { notifyUser } from "../notifications/notification.service";
import { HttpError } from "../../utils/httpError";
import type { RequestMeta } from "../auth/auth.service";

/*
 * Advisory-lock key for SEM-YYYY-XXXXXX certificate numbers (43010001 =
 * DAPG customer numbers, 43010002 = ORD order numbers).
 */
const CERTIFICATE_NUMBER_LOCK_KEY = 43010003;

/*
 * The modules whose completion unlocks Parent Stock ordering and
 * certificate requests, per the capstone paper.
 */
export const REQUIRED_MODULE_NUMBERS = [1, 2, 3];

/*
 * ---------- Paid module access ----------
 *
 * A paid module (price > 0) is OWNED once a seminar order for it reaches
 * the staff-verified payment state of the normal order workflow —
 * PAYMENT_VERIFIED, or any later fulfillment status. PENDING / APPROVED /
 * PAYMENT_SUBMITTED orders are purchases still awaiting staff
 * verification: they block duplicate purchases but do NOT unlock the
 * module. REJECTED and CANCELLED orders count as nothing.
 *
 * Access rule (enforced here AND mirrored by the customer UI):
 *   free module:  canAccess = every lower published module completed
 *   paid module:  canAccess = every lower published module completed
 *                             AND an owned purchase exists
 */
export const SEMINAR_OWNED_ORDER_STATUSES: OrderStatus[] = [
  "PAYMENT_VERIFIED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
];

export const SEMINAR_PENDING_ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "APPROVED",
  "PAYMENT_SUBMITTED",
];

export type SeminarPurchaseStatus =
  | "NOT_REQUIRED"
  | "NOT_PURCHASED"
  | "PENDING"
  | "OWNED";

export interface SeminarPurchaseInfo {
  owned: boolean;
  pending: boolean;
  orderId: string | null;
  orderNumber: string | null;
}

/*
 * Every live (not rejected/cancelled) seminar purchase of this customer,
 * keyed by module id. Ownership comes from relational identifiers only —
 * customer profile id + seminar module id on the order item — never from
 * titles, emails, or client state.
 */
export async function getSeminarPurchaseMap(
  client: Prisma.TransactionClient,
  customerProfileId: string
): Promise<Map<string, SeminarPurchaseInfo>> {
  const items = await client.orderItem.findMany({
    where: {
      itemType: "SEMINAR_MODULE",
      seminarModuleId: { not: null },
      order: {
        customerProfileId,
        status: {
          in: [
            ...SEMINAR_OWNED_ORDER_STATUSES,
            ...SEMINAR_PENDING_ORDER_STATUSES,
          ],
        },
      },
    },
    select: {
      seminarModuleId: true,
      order: {
        select: { id: true, orderNumber: true, status: true, createdAt: true },
      },
    },
    orderBy: { order: { createdAt: "asc" } },
  });

  const map = new Map<string, SeminarPurchaseInfo>();

  for (const item of items) {
    const moduleId = item.seminarModuleId!;
    const owned = SEMINAR_OWNED_ORDER_STATUSES.includes(item.order.status);

    // An owned purchase always wins; otherwise the latest pending one
    // (items arrive oldest-first, so later rows overwrite earlier ones).
    if (map.get(moduleId)?.owned) continue;
    map.set(moduleId, {
      owned,
      pending: !owned,
      orderId: item.order.id,
      orderNumber: item.order.orderNumber,
    });
  }

  return map;
}

interface ModuleAccessTarget {
  id: string;
  moduleNumber: number;
  price: Prisma.Decimal;
}

export interface ModuleAccessState {
  prerequisiteCompleted: boolean;
  /* The immediately previous published module's number (lock messaging);
     null when this is the lowest published module. */
  prerequisiteModuleNumber: number | null;
  purchase: SeminarPurchaseInfo | null;
  isFree: boolean;
  accessible: boolean;
}

/*
 * Access state of one module for one customer. The prerequisite mirrors
 * the customer UI's sequential rule exactly: EVERY published,
 * non-archived module with a lower number must be completed.
 */
export async function getModuleAccessState(
  client: Prisma.TransactionClient,
  customerProfileId: string,
  module: ModuleAccessTarget
): Promise<ModuleAccessState> {
  const lowerModules = await client.seminarModule.findMany({
    where: {
      isPublished: true,
      archivedAt: null,
      moduleNumber: { lt: module.moduleNumber },
    },
    select: { id: true, moduleNumber: true },
    orderBy: { moduleNumber: "asc" },
  });

  const completedLower =
    lowerModules.length === 0
      ? 0
      : await client.seminarEnrollment.count({
          where: {
            customerProfileId,
            completedAt: { not: null },
            moduleId: { in: lowerModules.map((entry) => entry.id) },
          },
        });

  const prerequisiteCompleted = completedLower === lowerModules.length;
  const prerequisiteModuleNumber =
    lowerModules.length > 0
      ? lowerModules[lowerModules.length - 1].moduleNumber
      : null;

  const isFree = module.price.lte(0);

  let purchase: SeminarPurchaseInfo | null = null;

  if (!isFree) {
    const purchases = await getSeminarPurchaseMap(client, customerProfileId);
    purchase = purchases.get(module.id) ?? null;
  }

  return {
    prerequisiteCompleted,
    prerequisiteModuleNumber,
    purchase,
    isFree,
    accessible: prerequisiteCompleted && (isFree || purchase?.owned === true),
  };
}

/* Peso display for lock messages (module prices are whole-peso values in
   practice; centavos appear only when actually set). */
function formatPesoAmount(price: Prisma.Decimal): string {
  const value = Number(price);
  const hasCentavos = !Number.isInteger(value);
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: hasCentavos ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/*
 * Content-access gate for the farmer learning endpoints (videos, quiz).
 * Throws 403 with a customer-readable reason; the customer UI shows the
 * same reasons on the module cards. Enrollment itself (startModule) stays
 * permissive — registering interest is not content access.
 */
export async function assertModuleContentAccessible(
  client: Prisma.TransactionClient,
  customerProfileId: string,
  module: ModuleAccessTarget & { title?: string }
): Promise<void> {
  const access = await getModuleAccessState(client, customerProfileId, module);

  if (access.accessible) return;

  const previousLabel =
    access.prerequisiteModuleNumber !== null
      ? `Module ${access.prerequisiteModuleNumber}`
      : "the previous module";

  const needsPurchase = !access.isFree && access.purchase?.owned !== true;

  if (!access.prerequisiteCompleted && needsPurchase) {
    throw new HttpError(
      403,
      `This module is locked. Complete ${previousLabel} and purchase this module (${formatPesoAmount(module.price)}) to continue.`
    );
  }

  if (!access.prerequisiteCompleted) {
    throw new HttpError(
      403,
      `This module is locked. Complete ${previousLabel} first.`
    );
  }

  if (access.purchase?.pending) {
    throw new HttpError(
      403,
      `This module is locked while your payment for order ${access.purchase.orderNumber} is awaiting DACS verification.`
    );
  }

  throw new HttpError(
    403,
    `This module requires purchase (${formatPesoAmount(module.price)}). Add it to your cart and complete checkout to continue.`
  );
}

/*
 * ---------- Issued-certificate validity ----------
 *
 * A DACS certificate is valid for exactly two years from the moment
 * staff officially ISSUE it (never from registration, completion,
 * approval or upload). validUntil is stored at issuance; the
 * VALID/EXPIRED status is always derived from it at read time so a
 * certificate expires automatically with no staff action.
 */
export const CERTIFICATE_VALIDITY_YEARS = 2;

export function certificateValidUntil(issuedAt: Date): Date {
  const validUntil = new Date(issuedAt.getTime());
  validUntil.setFullYear(validUntil.getFullYear() + CERTIFICATE_VALIDITY_YEARS);
  return validUntil;
}

export type CertificateValidityStatus = "NOT_ISSUED" | "VALID" | "EXPIRED";

/* Valid strictly BEFORE validUntil; on/after that instant it is expired. */
export function certificateValidityStatus(
  issuedAt: Date | null,
  validUntil: Date | null,
  now: Date = new Date()
): CertificateValidityStatus {
  if (!issuedAt || !validUntil) return "NOT_ISSUED";
  return now.getTime() < validUntil.getTime() ? "VALID" : "EXPIRED";
}

/*
 * ---------- Seminar completion cycle ----------
 *
 * Completing Modules 1-3 earns a Certificate of Attendance that stands
 * for the SAME two years the issued certificate does. This is the
 * server-side answer to "has this account finished the seminar, and is
 * that completion still current?" — the single record every client and
 * every gate reads, so a farmer never has to sit an exam again to prove
 * what the database already knows.
 *
 * The window reuses the certificate validity rule (no second timer):
 *   - staff-issued certificate -> its stored validUntil, exactly as the
 *     VALID/EXPIRED badge uses it;
 *   - approved-but-not-yet-issued -> certificateValidUntil() from the
 *     approval (auto-issue) moment, so the clock starts when the
 *     certificate is earned rather than whenever staff get to the file;
 *   - completed with no certificate row at all (historical accounts) ->
 *     the same helper from the last required module's completion.
 * A later staff issuance only ever moves the window forward, so nothing
 * an account already earned is shortened.
 */
export interface SeminarCompletionCertificate {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  certificateNumber: string | null;
  /** Approval / auto-issue moment — the SEM number's own date. */
  approvedAt: Date | null;
  /** Official staff issuance (starts the stored 2-year window). */
  issuedAt: Date | null;
  validUntil: Date | null;
  hasCertificateFile: boolean;
  validityStatus: CertificateValidityStatus;
}

export interface SeminarCompletionState {
  completedRequiredModules: number;
  requiredModuleNumbers: number[];
  allRequiredCompleted: boolean;
  /** When the last required module was finished. */
  completedAt: Date | null;
  certificate: SeminarCompletionCertificate | null;
  /** End of the current cycle's 2-year window (null when nothing earned). */
  completionValidUntil: Date | null;
  completionValidityStatus: "NONE" | "VALID" | "EXPIRED";
  /*
   * True while the finished seminar must stay finished: the exams are
   * closed and the certificate is simply retrieved. Lifts on its own the
   * moment the two years elapse — that is the retake eligibility date.
   */
  retakeLocked: boolean;
}

export async function getSeminarCompletionState(
  client: Prisma.TransactionClient,
  customerProfileId: string,
  now: Date = new Date()
): Promise<SeminarCompletionState> {
  /* Independent reads — issued together so the cycle costs one database
     round-trip rather than two (each one crosses the Cloud SQL proxy). */
  const [completedEnrollments, row] = await Promise.all([
    client.seminarEnrollment.findMany({
      where: {
        customerProfileId,
        completedAt: { not: null },
        module: { moduleNumber: { in: REQUIRED_MODULE_NUMBERS } },
      },
      select: { completedAt: true },
      orderBy: { completedAt: "desc" },
    }),
    /* The account's live certificate for this cycle (rejected ones are
       not a cycle — the farmer may request again). */
    client.certificateRequest.findFirst({
      where: { customerProfileId, status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        status: true,
        certificateNumber: true,
        requestedAt: true,
        reviewedAt: true,
        certificateIssuedAt: true,
        issuedAt: true,
        validUntil: true,
        certificateFilePath: true,
      },
    }),
  ]);

  const completedRequiredModules = completedEnrollments.length;
  const allRequiredCompleted =
    completedRequiredModules === REQUIRED_MODULE_NUMBERS.length;
  const completedAt = allRequiredCompleted
    ? (completedEnrollments[0]?.completedAt ?? null)
    : null;

  const certificate: SeminarCompletionCertificate | null = row
    ? {
        id: row.id,
        status: row.status,
        certificateNumber: row.certificateNumber,
        approvedAt: row.certificateIssuedAt ?? row.reviewedAt,
        issuedAt: row.issuedAt,
        validUntil: row.validUntil,
        hasCertificateFile: row.certificateFilePath !== null,
        validityStatus: certificateValidityStatus(
          row.issuedAt,
          row.validUntil,
          now
        ),
      }
    : null;

  /* Anchor, most authoritative first. */
  const anchor = row
    ? (row.issuedAt ??
      row.certificateIssuedAt ??
      row.reviewedAt ??
      row.requestedAt)
    : completedAt;

  const completionValidUntil =
    anchor === null
      ? null
      : (row?.validUntil ?? certificateValidUntil(anchor));

  const stillValid =
    completionValidUntil !== null &&
    now.getTime() < completionValidUntil.getTime();

  return {
    completedRequiredModules,
    requiredModuleNumbers: REQUIRED_MODULE_NUMBERS,
    allRequiredCompleted,
    completedAt,
    certificate,
    completionValidUntil: allRequiredCompleted ? completionValidUntil : null,
    completionValidityStatus: !allRequiredCompleted
      ? "NONE"
      : stillValid
        ? "VALID"
        : "EXPIRED",
    retakeLocked: allRequiredCompleted && stillValid,
  };
}

/*
 * Exam gate for a finished seminar. Once Modules 1-3 are complete and
 * the completion is still inside its two-year window, the required
 * modules' exams are closed — the account keeps the result it already
 * earned instead of putting it at risk on a retake. Optional modules
 * outside the required trio, failed attempts and every not-yet-finished
 * seminar are untouched, and the gate lifts by itself at expiry.
 */
async function assertQuizRetakeAllowed(
  client: Prisma.TransactionClient,
  customerProfileId: string,
  module: { id: string; moduleNumber: number }
): Promise<void> {
  if (!REQUIRED_MODULE_NUMBERS.includes(module.moduleNumber)) return;

  const enrollment = await client.seminarEnrollment.findUnique({
    where: {
      customerProfileId_moduleId: { customerProfileId, moduleId: module.id },
    },
    select: { completedAt: true },
  });

  if (!enrollment?.completedAt) return;

  const completion = await getSeminarCompletionState(client, customerProfileId);
  if (!completion.retakeLocked) return;

  throw new HttpError(
    409,
    "You have already completed this seminar. Your Certificate of Attendance stays valid until " +
      `${completion.completionValidUntil?.toISOString().slice(0, 10)} — the exams reopen after that date.`
  );
}

export interface CreateModuleInput {
  moduleNumber: number;
  title: string;
  description?: string | null;
  passingScore: number;
  /* Access price in pesos; omitted/0 = free module. */
  price?: number;
}

export interface UpdateModuleInput {
  title?: string;
  description?: string | null;
  passingScore?: number;
  isPublished?: boolean;
  price?: number;
}

export interface CreateVideoInput {
  title: string;
  videoUrl: string;
  description?: string | null;
  displayOrder: number;
  /* Upload metadata: client-probed length + original file name. Both
     stay null for URL-based (non-uploaded) videos. */
  durationSeconds?: number | null;
  fileName?: string | null;
}

export interface UpdateVideoInput {
  title?: string;
  videoUrl?: string;
  description?: string | null;
}

export interface CreateQuestionInput {
  questionText: string;
  points: number;
  displayOrder: number;
  choices: {
    choiceText: string;
    isCorrect: boolean;
    displayOrder: number;
  }[];
}

export interface UpdateQuestionInput {
  questionText?: string;
  points?: number;
  /*
   * When present, this is the question's FULL desired choice set:
   * entries with an id update that existing choice (the id survives, so
   * historical quiz attempts keep resolving), entries without an id are
   * created, and existing choices left out of the list are removed.
   */
  choices?: {
    id?: string;
    choiceText: string;
    isCorrect: boolean;
    displayOrder: number;
  }[];
}

export interface QuizAnswerInput {
  questionId: string;
  choiceId: string;
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

/*
 * Completion rule: every video in the module at 100% AND at least one
 * passing quiz attempt. Called after each progress update and each quiz
 * submission so completedAt appears the moment both halves are done.
 *
 * When the flip completes the LAST of the required Modules 1-3, the
 * farmer's Certificate of Attendance is issued automatically in the same
 * transaction (see autoIssueSeminarCertificate) — `actor` identifies who
 * caused the write for the activity log (the farmer, or the staff member
 * whose video archival completed the module).
 */
async function recalculateEnrollmentCompletion(
  transaction: Prisma.TransactionClient,
  enrollmentId: string,
  actor: { userId: string; meta?: RequestMeta }
): Promise<boolean> {
  const enrollment = await transaction.seminarEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      module: {
        // Archived (removed) videos no longer count toward "all videos
        // watched" — otherwise a removed video would block completion
        // forever.
        include: {
          videos: { where: { archivedAt: null }, select: { id: true } },
        },
      },
      progress: true,
      quizAttempts: {
        where: { passed: true },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!enrollment) return false;
  if (enrollment.completedAt) return true;

  const totalVideos = enrollment.module.videos.length;
  // Only progress on the module's ACTIVE videos counts — a watched
  // video that was later archived must neither block nor overcount.
  const activeVideoIds = new Set(
    enrollment.module.videos.map((video) => video.id)
  );
  const completedVideos = enrollment.progress.filter(
    (progress) =>
      progress.progressPercent === 100 && activeVideoIds.has(progress.videoId)
  ).length;

  const allVideosCompleted = totalVideos > 0 && completedVideos === totalVideos;
  const quizPassed = enrollment.quizAttempts.length > 0;

  if (allVideosCompleted && quizPassed) {
    await transaction.seminarEnrollment.update({
      where: { id: enrollment.id },
      data: { completedAt: new Date() },
    });
    // Completing a required module may complete the whole 1-2-3 set —
    // the certificate is generated right here, never earlier.
    if (REQUIRED_MODULE_NUMBERS.includes(enrollment.module.moduleNumber)) {
      await autoIssueSeminarCertificate(
        transaction,
        enrollment.customerProfileId,
        actor
      );
    }
    return true;
  }

  return false;
}

/*
 * Year-scoped SEM-YYYY-NNNNNN numbering shared by staff approval and
 * automatic issuance. Callers must run inside a transaction; the
 * advisory lock serializes concurrent issuances (reentrant, so taking
 * it again around the existence check is safe).
 */
async function nextCertificateNumber(
  transaction: Prisma.TransactionClient
): Promise<string> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${CERTIFICATE_NUMBER_LOCK_KEY})`;

  /*
   * Numbers are scoped per year (SEM-2026-000001, SEM-2027-000001, ...)
   * and derived from the latest issued number, so deletions can never
   * cause a duplicate the way a row count could.
   */
  const year = new Date().getFullYear();
  const prefix = `SEM-${year}-`;

  const latestCertificate = await transaction.certificateRequest.findFirst({
    where: { certificateNumber: { startsWith: prefix } },
    orderBy: { certificateNumber: "desc" },
    select: { certificateNumber: true },
  });

  let nextNumber = 1;

  if (latestCertificate?.certificateNumber) {
    const previousNumber = Number(
      latestCertificate.certificateNumber.slice(prefix.length)
    );
    if (Number.isFinite(previousNumber)) {
      nextNumber = previousNumber + 1;
    }
  }

  return `${prefix}${String(nextNumber).padStart(6, "0")}`;
}

/*
 * Issues the Certificate of Attendance the moment Modules 1, 2 and 3 are
 * all complete — no farmer request, staff review, upload or issue step.
 * The row is a regular certificate_requests entry created already
 * APPROVED and ISSUED, so every existing consumer — the customer
 * certificate pages, the admin listings, notifications — works
 * unchanged. No-ops unless the trio is complete; idempotent while a
 * PENDING/APPROVED request exists (legacy manual requests included).
 *
 * One instant is the certificate's issue date (certificateIssuedAt =
 * issuedAt) and validUntil is that date + CERTIFICATE_VALIDITY_YEARS,
 * so the 2-year window is stored on the record at birth: the admin
 * table reads a real Validity Date and a derived Valid status on its
 * very next refresh, with nothing for staff to enter.
 */
async function autoIssueSeminarCertificate(
  transaction: Prisma.TransactionClient,
  customerProfileId: string,
  actor: { userId: string; meta?: RequestMeta }
): Promise<void> {
  const completed = await countCompletedRequiredModules(
    transaction,
    customerProfileId
  );
  if (completed !== REQUIRED_MODULE_NUMBERS.length) return;

  // Serialize the existence check with other issuances (same lock the
  // numbering uses) so concurrent completions cannot double-issue.
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${CERTIFICATE_NUMBER_LOCK_KEY})`;

  const existing = await transaction.certificateRequest.findFirst({
    where: {
      customerProfileId,
      status: { in: ["PENDING", "APPROVED"] },
    },
    select: { id: true },
  });
  if (existing) return;

  const profile = await transaction.customerProfile.findUnique({
    where: { id: customerProfileId },
    select: { userId: true, customerNumber: true },
  });
  if (!profile) return;

  const certificateNumber = await nextCertificateNumber(transaction);
  const now = new Date();

  const request = await transaction.certificateRequest.create({
    data: {
      customerProfileId,
      status: "APPROVED",
      reviewedAt: now,
      reviewNotes:
        "Issued automatically after completing Seminar Modules 1, 2, and 3.",
      certificateNumber,
      certificateIssuedAt: now,
      /* Issued by DACS itself: issuedByUserId stays null (no staff
         actor) and the 2-year window starts at this same instant. */
      issuedAt: now,
      validUntil: certificateValidUntil(now),
    },
  });

  await recordActivity(transaction, {
    userId: actor.userId,
    module: "SEMINARS",
    action: "CERTIFICATE_AUTO_ISSUED",
    description: `Seminar certificate ${certificateNumber} was issued automatically to customer ${profile.customerNumber} after completing Modules 1-3.`,
    recordType: "CertificateRequest",
    recordId: request.id,
    metadata: { certificateNumber },
    ipAddress: actor.meta?.ipAddress,
    userAgent: actor.meta?.userAgent,
  });

  // Same farmer notification the manual approval path sends.
  if (profile.userId) {
    await notifyUser(transaction, profile.userId, {
      type: "CERTIFICATE_APPROVED",
      title: "Seminar certificate issued",
      message: `Congratulations! You completed Seminar Modules 1-3 and your certificate ${certificateNumber} has been issued.`,
      recordType: "CertificateRequest",
      recordId: request.id,
    });
  }
}

export async function countCompletedRequiredModules(
  client: Prisma.TransactionClient,
  customerProfileId: string
): Promise<number> {
  return client.seminarEnrollment.count({
    where: {
      customerProfileId,
      completedAt: { not: null },
      module: { moduleNumber: { in: REQUIRED_MODULE_NUMBERS } },
    },
  });
}

/*
 * ---------- Staff content management ----------
 */

export async function createSeminarModule(
  actorUserId: string,
  input: CreateModuleInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.seminarModule.findUnique({
      where: { moduleNumber: input.moduleNumber },
    });

    if (existing) {
      throw new HttpError(
        409,
        "A seminar module with this number already exists."
      );
    }

    const module = await transaction.seminarModule.create({
      data: {
        moduleNumber: input.moduleNumber,
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore,
        // toFixed(2) keeps the value inside the Decimal(12,2) money
        // representation — never floating point.
        price: new Prisma.Decimal((input.price ?? 0).toFixed(2)),
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_MODULE_CREATED",
      description: `Seminar Module ${module.moduleNumber} - ${module.title} was created.`,
      recordType: "SeminarModule",
      recordId: module.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return module;
  });
}

export async function updateSeminarModule(
  actorUserId: string,
  moduleId: string,
  input: UpdateModuleInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!existing) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    // An archived module is "deleted with history" — it must not come
    // back to farmers through a publish flag flip.
    if (existing.archivedAt && input.isPublished === true) {
      throw new HttpError(
        409,
        "This seminar module is archived and cannot be published."
      );
    }

    const data: Prisma.SeminarModuleUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.passingScore !== undefined) data.passingScore = input.passingScore;
    if (input.isPublished !== undefined) data.isPublished = input.isPublished;
    if (input.price !== undefined) {
      data.price = new Prisma.Decimal(input.price.toFixed(2));
    }

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one module field must be supplied.");
    }

    /*
     * Publish-state bookkeeping (never client-settable): editing content
     * on a published module marks it as needing re-publish; explicitly
     * setting isPublished — either way — resolves that pending state.
     * Price is a commercial setting, not module content — it takes
     * effect immediately and never demands a re-publish (existing
     * purchases keep their own checkout-time snapshots regardless).
     */
    const contentChanged =
      input.title !== undefined ||
      input.description !== undefined ||
      input.passingScore !== undefined;

    if (input.isPublished !== undefined) {
      data.hasUnpublishedChanges = false;
    } else if (contentChanged && existing.isPublished) {
      data.hasUnpublishedChanges = true;
    }

    const module = await transaction.seminarModule.update({
      where: { id: moduleId },
      data,
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_MODULE_UPDATED",
      description: `Seminar Module ${module.moduleNumber} was updated.`,
      recordType: "SeminarModule",
      recordId: module.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return module;
  });
}

export async function addSeminarVideo(
  actorUserId: string,
  moduleId: string,
  input: CreateVideoInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    const video = await transaction.seminarVideo.create({
      data: {
        moduleId,
        title: input.title,
        videoUrl: input.videoUrl,
        description: input.description ?? null,
        displayOrder: input.displayOrder,
        durationSeconds: input.durationSeconds ?? null,
        fileName: input.fileName ?? null,
      },
    });

    // Same transaction as the content write: the pending-changes flag
    // can never outlive a video insert that rolled back.
    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_VIDEO_CREATED",
      description: `A video was added to Seminar Module ${module.moduleNumber}.`,
      recordType: "SeminarVideo",
      recordId: video.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return video;
  });
}

export async function addSeminarQuestion(
  actorUserId: string,
  moduleId: string,
  input: CreateQuestionInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    const correctCount = input.choices.filter(
      (choice) => choice.isCorrect
    ).length;

    if (input.choices.length < 2 || correctCount !== 1) {
      throw new HttpError(
        400,
        "A question needs at least two choices and exactly one correct answer."
      );
    }

    const question = await transaction.seminarQuestion.create({
      data: {
        moduleId,
        questionText: input.questionText,
        points: input.points,
        displayOrder: input.displayOrder,
        choices: { create: input.choices },
      },
      include: {
        choices: { orderBy: { displayOrder: "asc" } },
      },
    });

    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_QUESTION_CREATED",
      description: `A quiz question was added to Seminar Module ${module.moduleNumber}.`,
      recordType: "SeminarQuestion",
      recordId: question.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return question;
  });
}

/*
 * Shared guard for content edits: the module must exist and must not be
 * archived (an archived module is "deleted with history" — its content
 * is frozen).
 */
async function getEditableModule(
  transaction: Prisma.TransactionClient,
  moduleId: string
) {
  const module = await transaction.seminarModule.findUnique({
    where: { id: moduleId },
  });

  if (!module) {
    throw new HttpError(404, "Seminar module was not found.");
  }

  if (module.archivedAt) {
    throw new HttpError(
      409,
      "This seminar module is archived and its content cannot be edited."
    );
  }

  return module;
}

export async function updateSeminarVideo(
  actorUserId: string,
  moduleId: string,
  videoId: string,
  input: UpdateVideoInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await getEditableModule(transaction, moduleId);

    const video = await transaction.seminarVideo.findUnique({
      where: { id: videoId },
    });

    // A video belonging to another module is reported as missing, the
    // same existence-hiding the delete endpoint uses.
    if (!video || video.moduleId !== moduleId) {
      throw new HttpError(404, "Seminar video was not found.");
    }

    if (video.archivedAt) {
      throw new HttpError(
        409,
        "This seminar video was removed and can no longer be edited."
      );
    }

    const data: Prisma.SeminarVideoUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
    if (input.description !== undefined) data.description = input.description;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "At least one video field must be supplied.");
    }

    const updated = await transaction.seminarVideo.update({
      where: { id: videoId },
      data,
    });

    // Same content-change bookkeeping as adding a video.
    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_VIDEO_UPDATED",
      description: `Video "${updated.title}" in Seminar Module ${module.moduleNumber} was updated.`,
      recordType: "SeminarVideo",
      recordId: updated.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  });
}

/*
 * Reordering follows the FAQ contract: the request is the full desired
 * order of the module's ACTIVE videos, and displayOrder becomes each
 * ID's position in that list. Requiring every active video exactly once
 * keeps the operation atomic — a partial list can never leave duplicate
 * or missing positions. Archived videos keep their old positions; they
 * are already excluded from every payload.
 */
export async function reorderSeminarVideos(
  actorUserId: string,
  moduleId: string,
  orderedVideoIds: string[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await getEditableModule(transaction, moduleId);

    const activeVideos = await transaction.seminarVideo.findMany({
      where: { moduleId, archivedAt: null },
      select: { id: true },
    });

    const uniqueIds = new Set(orderedVideoIds);

    if (
      uniqueIds.size !== orderedVideoIds.length ||
      activeVideos.length !== orderedVideoIds.length ||
      !activeVideos.every((video) => uniqueIds.has(video.id))
    ) {
      throw new HttpError(
        400,
        "The reorder list must contain every video of this module exactly once."
      );
    }

    for (const [index, videoId] of orderedVideoIds.entries()) {
      await transaction.seminarVideo.update({
        where: { id: videoId },
        data: { displayOrder: index + 1 },
      });
    }

    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_VIDEOS_REORDERED",
      description: `The videos of Seminar Module ${module.moduleNumber} were reordered.`,
      recordType: "SeminarModule",
      recordId: module.id,
      metadata: { videoCount: orderedVideoIds.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.seminarVideo.findMany({
      where: { moduleId, archivedAt: null },
      orderBy: { displayOrder: "asc" },
    });
  });
}

/*
 * Editing a question updates the row IN PLACE — the question keeps its
 * ID, so historical quiz attempts (which store question/choice IDs as
 * JSON) keep resolving. Choice edits preserve IDs the same way when the
 * frontend sends them back.
 */
export async function updateSeminarQuestion(
  actorUserId: string,
  moduleId: string,
  questionId: string,
  input: UpdateQuestionInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await getEditableModule(transaction, moduleId);

    const question = await transaction.seminarQuestion.findUnique({
      where: { id: questionId },
      include: { choices: { select: { id: true } } },
    });

    if (!question || question.moduleId !== moduleId) {
      throw new HttpError(404, "Seminar question was not found.");
    }

    if (!question.isActive) {
      throw new HttpError(
        409,
        "This seminar question was removed and can no longer be edited."
      );
    }

    const data: Prisma.SeminarQuestionUpdateInput = {};
    if (input.questionText !== undefined) data.questionText = input.questionText;
    if (input.points !== undefined) data.points = input.points;

    if (Object.keys(data).length === 0 && input.choices === undefined) {
      throw new HttpError(400, "At least one question field must be supplied.");
    }

    if (input.choices !== undefined) {
      // Same rule as creation: at least two choices, exactly one correct.
      const correctCount = input.choices.filter(
        (choice) => choice.isCorrect
      ).length;

      if (input.choices.length < 2 || correctCount !== 1) {
        throw new HttpError(
          400,
          "A question needs at least two choices and exactly one correct answer."
        );
      }

      const existingChoiceIds = new Set(
        question.choices.map((choice) => choice.id)
      );
      const submittedIds = input.choices
        .map((choice) => choice.id)
        .filter((id): id is string => id !== undefined);

      if (new Set(submittedIds).size !== submittedIds.length) {
        throw new HttpError(
          400,
          "The same choice ID cannot appear more than once."
        );
      }

      const foreignId = submittedIds.find((id) => !existingChoiceIds.has(id));
      if (foreignId) {
        throw new HttpError(
          400,
          "One or more choice IDs do not belong to this question."
        );
      }

      // Choices dropped from the list are removed. Quiz attempts store
      // their answers as JSON (no foreign keys), so history is safe.
      const keptIds = new Set(submittedIds);
      await transaction.seminarChoice.deleteMany({
        where: { questionId, id: { notIn: [...keptIds] } },
      });

      for (const choice of input.choices) {
        if (choice.id) {
          await transaction.seminarChoice.update({
            where: { id: choice.id },
            data: {
              choiceText: choice.choiceText,
              isCorrect: choice.isCorrect,
              displayOrder: choice.displayOrder,
            },
          });
        } else {
          await transaction.seminarChoice.create({
            data: {
              questionId,
              choiceText: choice.choiceText,
              isCorrect: choice.isCorrect,
              displayOrder: choice.displayOrder,
            },
          });
        }
      }
    }

    const updated = await transaction.seminarQuestion.update({
      where: { id: questionId },
      data,
      include: { choices: { orderBy: { displayOrder: "asc" } } },
    });

    // Same content-change bookkeeping as adding a question.
    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_QUESTION_UPDATED",
      description: `A quiz question in Seminar Module ${module.moduleNumber} was updated.`,
      recordType: "SeminarQuestion",
      recordId: updated.id,
      metadata: {
        updatedFields: [
          ...Object.keys(data),
          ...(input.choices !== undefined ? ["choices"] : []),
        ],
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  });
}

/*
 * Certificate-template upload: the controller saves the image through
 * the shared file-storage service first, then records the URL here. The
 * previous URL is returned so the controller can delete the replaced
 * file, exactly like profile images and farm logos.
 */
export async function updateSeminarCertificateTemplate(
  actorUserId: string,
  moduleId: string,
  templateUrl: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await getEditableModule(transaction, moduleId);
    const previousTemplateUrl = module.certificateTemplateUrl;

    const updated = await transaction.seminarModule.update({
      where: { id: moduleId },
      data: {
        certificateTemplateUrl: templateUrl,
        // The certificate is part of the module's published content.
        ...(module.isPublished ? { hasUnpublishedChanges: true } : {}),
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_CERTIFICATE_TEMPLATE_UPDATED",
      description: `The certificate template for Seminar Module ${module.moduleNumber} was updated.`,
      recordType: "SeminarModule",
      recordId: module.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { module: updated, previousTemplateUrl };
  });
}

/*
 * Module cover image (the artwork on the customer-facing seminar card).
 * Same storage contract as the certificate template: the controller
 * saves the file first and records the URL here; the previous URL is
 * returned so the replaced file can be deleted. Passing null removes
 * the cover (the customer card falls back to a neutral placeholder).
 */
export async function updateSeminarCoverImage(
  actorUserId: string,
  moduleId: string,
  coverImageUrl: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await getEditableModule(transaction, moduleId);
    const previousCoverImageUrl = module.coverImageUrl;

    if (coverImageUrl === null && !previousCoverImageUrl) {
      throw new HttpError(409, "This module has no cover image to remove.");
    }

    const updated = await transaction.seminarModule.update({
      where: { id: moduleId },
      data: {
        coverImageUrl,
        // The cover is part of the module's published content.
        ...(module.isPublished ? { hasUnpublishedChanges: true } : {}),
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action:
        coverImageUrl === null
          ? "SEMINAR_COVER_IMAGE_REMOVED"
          : "SEMINAR_COVER_IMAGE_UPDATED",
      description:
        coverImageUrl === null
          ? `The cover image for Seminar Module ${module.moduleNumber} was removed.`
          : `The cover image for Seminar Module ${module.moduleNumber} was updated.`,
      recordType: "SeminarModule",
      recordId: module.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { module: updated, previousCoverImageUrl };
  });
}

/*
 * ---------- Staff deletion ----------
 *
 * DACS never destroys farmer history. Each delete decides between a
 * true delete (no history exists) and an archive (history exists):
 *
 * - Modules: enrollments are the history gate (progress/quiz attempts
 *   hang off enrollments, so zero enrollments means zero history).
 *   Hard delete cascades videos/questions/choices; archive hides the
 *   module from farmers (isPublished false) and keeps every record.
 * - Videos: watch-progress rows are the gate — seminar_progress
 *   cascades off videos, so a hard delete with history would silently
 *   erase it. Archived videos leave the module's active content but
 *   keep their progress rows.
 * - Questions: always a soft delete (isActive false) because quiz
 *   attempts store question/choice IDs; the quiz layer already filters
 *   on isActive everywhere.
 */

export async function deleteSeminarModule(
  actorUserId: string,
  moduleId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    const enrollmentCount = await transaction.seminarEnrollment.count({
      where: { moduleId },
    });

    /*
     * Sold access is transaction history: a module referenced by any
     * order item must be archived, never hard-deleted (the FK is
     * Restrict, so the delete would fail anyway — this keeps the
     * archive path deliberate instead of an FK error).
     */
    const purchaseCount = await transaction.orderItem.count({
      where: { seminarModuleId: moduleId },
    });

    if (enrollmentCount === 0 && purchaseCount === 0) {
      /*
       * The row cascade destroys video rows; collect their uploaded
       * file URLs first so the controller can remove the stored files
       * (best-effort, after the transaction commits).
       */
      const videoUrls = (
        await transaction.seminarVideo.findMany({
          where: { moduleId },
          select: { videoUrl: true },
        })
      ).map((video) => video.videoUrl);

      await transaction.seminarModule.delete({ where: { id: moduleId } });

      await recordActivity(transaction, {
        userId: actorUserId,
        module: "SEMINARS",
        action: "SEMINAR_MODULE_DELETED",
        description: `Seminar Module ${module.moduleNumber} - ${module.title} was permanently deleted (no enrollment history).`,
        recordType: "SeminarModule",
        recordId: module.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return { result: "DELETED" as const, module, enrollmentCount, videoUrls };
    }

    if (module.archivedAt) {
      throw new HttpError(409, "This seminar module is already archived.");
    }

    const archived = await transaction.seminarModule.update({
      where: { id: moduleId },
      data: {
        archivedAt: new Date(),
        isPublished: false,
        hasUnpublishedChanges: false,
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_MODULE_ARCHIVED",
      description: `Seminar Module ${module.moduleNumber} - ${module.title} was archived instead of deleted (${enrollmentCount} enrollment(s) preserved).`,
      recordType: "SeminarModule",
      recordId: module.id,
      metadata: { enrollmentCount },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { result: "ARCHIVED" as const, module: archived, enrollmentCount };
  });
}

export async function deleteSeminarVideo(
  actorUserId: string,
  moduleId: string,
  videoId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    const video = await transaction.seminarVideo.findUnique({
      where: { id: videoId },
    });

    // A video belonging to another module is reported as missing, the
    // same existence-hiding used for farm ownership violations.
    if (!video || video.moduleId !== moduleId) {
      throw new HttpError(404, "Seminar video was not found.");
    }

    if (video.archivedAt) {
      throw new HttpError(409, "This seminar video was already removed.");
    }

    const progressCount = await transaction.seminarProgress.count({
      where: { videoId },
    });

    let result: "DELETED" | "ARCHIVED";

    if (progressCount === 0) {
      await transaction.seminarVideo.delete({ where: { id: videoId } });
      result = "DELETED";
    } else {
      await transaction.seminarVideo.update({
        where: { id: videoId },
        data: { archivedAt: new Date() },
      });
      result = "ARCHIVED";
    }

    // Removing a video changes what "all videos watched" means, so
    // every enrollment of the module is re-evaluated — a farmer who had
    // finished everything else may complete right now.
    const enrollments = await transaction.seminarEnrollment.findMany({
      where: { moduleId },
      select: { id: true },
    });

    for (const enrollment of enrollments) {
      await recalculateEnrollmentCompletion(transaction, enrollment.id, {
        userId: actorUserId,
        meta,
      });
    }

    // Same content-change bookkeeping as adding a video.
    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action:
        result === "DELETED" ? "SEMINAR_VIDEO_DELETED" : "SEMINAR_VIDEO_ARCHIVED",
      description:
        result === "DELETED"
          ? `Video "${video.title}" was permanently deleted from Seminar Module ${module.moduleNumber} (no watch history).`
          : `Video "${video.title}" was archived from Seminar Module ${module.moduleNumber} (${progressCount} progress record(s) preserved).`,
      recordType: "SeminarVideo",
      recordId: video.id,
      metadata: { progressCount },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { result, video, progressCount };
  });
}

/*
 * DELETE on a question is a documented SOFT delete: the row keeps its
 * choices and stays referenced by historical quiz attempts, it simply
 * stops being part of the active quiz (isActive false — the flag every
 * quiz read already filters on). Repeating the delete is idempotent.
 */
export async function deleteSeminarQuestion(
  actorUserId: string,
  moduleId: string,
  questionId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const module = await transaction.seminarModule.findUnique({
      where: { id: moduleId },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    const question = await transaction.seminarQuestion.findUnique({
      where: { id: questionId },
    });

    if (!question || question.moduleId !== moduleId) {
      throw new HttpError(404, "Seminar question was not found.");
    }

    if (!question.isActive) {
      return { result: "ALREADY_INACTIVE" as const, question };
    }

    const deactivated = await transaction.seminarQuestion.update({
      where: { id: questionId },
      data: { isActive: false },
    });

    // Same content-change bookkeeping as adding a question.
    if (module.isPublished) {
      await transaction.seminarModule.update({
        where: { id: moduleId },
        data: { hasUnpublishedChanges: true },
      });
    }

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action: "SEMINAR_QUESTION_DELETED",
      description: `A quiz question was soft-deleted (deactivated) from Seminar Module ${module.moduleNumber}.`,
      recordType: "SeminarQuestion",
      recordId: question.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { result: "SOFT_DELETED" as const, question: deactivated };
  });
}

/*
 * ---------- Module listing ----------
 *
 * Staff see every module (drafts included); farmers only see published
 * ones. Neither payload includes quiz answers.
 */
/*
 * Cumulative sequential-access computation over the published module
 * list (ascending module numbers): a module's prerequisite is met when
 * every module before it in the list is completed. Shared by the farmer
 * catalog (video-URL stripping) and the progress payload so both always
 * agree with assertModuleContentAccessible.
 */
function computeSequentialAccess(
  orderedModules: Array<{ id: string; moduleNumber: number; price: Prisma.Decimal }>,
  completedModuleIds: Set<string>,
  purchases: Map<string, SeminarPurchaseInfo>
): Map<string, ModuleAccessState> {
  const states = new Map<string, ModuleAccessState>();

  let allPreviousCompleted = true;
  let previousModuleNumber: number | null = null;

  for (const module of orderedModules) {
    const isFree = module.price.lte(0);
    const purchase = isFree ? null : (purchases.get(module.id) ?? null);

    states.set(module.id, {
      prerequisiteCompleted: allPreviousCompleted,
      prerequisiteModuleNumber: previousModuleNumber,
      purchase,
      isFree,
      accessible:
        allPreviousCompleted && (isFree || purchase?.owned === true),
    });

    allPreviousCompleted =
      allPreviousCompleted && completedModuleIds.has(module.id);
    previousModuleNumber = module.moduleNumber;
  }

  return states;
}

export async function getSeminarModules(
  includeUnpublished: boolean,
  /*
   * When set (farmer requests), video URLs of modules the farmer cannot
   * access yet are stripped from the payload — locked content is not
   * handed to the browser just because the catalog is visible.
   */
  farmerUserId?: string
) {
  const modulesQuery = prisma.seminarModule.findMany({
    /*
     * Staff see every module including archived ones (archivedAt in the
     * payload lets the UI badge them); farmers only see published,
     * never-archived modules. Archived VIDEOS are excluded for both —
     * they are deleted content whose rows only preserve watch history.
     */
    where: includeUnpublished
      ? undefined
      : { isPublished: true, archivedAt: null },
    include: {
      videos: {
        where: { archivedAt: null },
        select: {
          id: true,
          title: true,
          videoUrl: true,
          description: true,
          displayOrder: true,
          durationSeconds: true,
          fileName: true,
        },
        orderBy: { displayOrder: "asc" },
      },
      _count: {
        select: { questions: { where: { isActive: true } } },
      },
    },
    orderBy: { moduleNumber: "asc" },
  });

  if (!farmerUserId) return modulesQuery;

  /*
   * Farmers without a customer profile yet have no completions and no
   * purchases — only the first free module's content stays readable.
   * The catalog and the profile lookup are independent, so they go out
   * together rather than one Cloud SQL round-trip after the other.
   */
  const [modules, profile] = await Promise.all([
    modulesQuery,
    getActiveProfileForUser(prisma, farmerUserId),
  ]);

  let completedModuleIds = new Set<string>();
  let purchases = new Map<string, SeminarPurchaseInfo>();

  if (profile) {
    // Both depend only on the profile id — also one round-trip, not two.
    const [completions, purchaseMap] = await Promise.all([
      prisma.seminarEnrollment.findMany({
        where: { customerProfileId: profile.id, completedAt: { not: null } },
        select: { moduleId: true },
      }),
      getSeminarPurchaseMap(prisma, profile.id),
    ]);
    completedModuleIds = new Set(completions.map((entry) => entry.moduleId));
    purchases = purchaseMap;
  }

  const access = computeSequentialAccess(modules, completedModuleIds, purchases);

  return modules.map((module) => {
    if (access.get(module.id)?.accessible) return module;
    return {
      ...module,
      videos: module.videos.map((video) => ({ ...video, videoUrl: null })),
    };
  });
}

/*
 * Staff module detail: the full editing payload — active videos plus
 * active questions WITH their choices including isCorrect. Never served
 * to farmers (their quiz endpoint strips answers); the staff-only route
 * guard enforces that.
 */
export async function getSeminarModuleDetail(moduleId: string) {
  const module = await prisma.seminarModule.findUnique({
    where: { id: moduleId },
    include: {
      videos: {
        where: { archivedAt: null },
        orderBy: { displayOrder: "asc" },
      },
      questions: {
        where: { isActive: true },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        include: {
          choices: { orderBy: { displayOrder: "asc" } },
        },
      },
    },
  });

  if (!module) {
    throw new HttpError(404, "Seminar module was not found.");
  }

  return module;
}

/*
 * Staff seminar-progress overview: one entry per customer who has
 * enrolled in any module, with their enrollments (module numbers +
 * completion) and latest approved certificate number. Read-only — this
 * feeds the admin Seminar Progress monitoring table.
 */
export async function getSeminarProgressOverview() {
  return prisma.customerProfile.findMany({
    where: { seminarEnrollments: { some: {} } },
    select: {
      id: true,
      customerNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      occupation: true,
      phoneNumber: true,
      contactEmail: true,
      facebookName: true,
      addressLine1: true,
      barangay: true,
      cityMunicipality: true,
      province: true,
      seminarEnrollments: {
        select: {
          startedAt: true,
          completedAt: true,
          module: {
            select: { moduleNumber: true, title: true, archivedAt: true },
          },
        },
        orderBy: { module: { moduleNumber: "asc" } },
      },
      certificateRequests: {
        where: { status: "APPROVED" },
        orderBy: { certificateIssuedAt: "desc" },
        take: 1,
        /*
         * Everything the admin certificate workflow needs — but not the
         * stored file path (files are only reachable through the
         * authenticated download endpoints).
         */
        select: {
          id: true,
          status: true,
          certificateNumber: true,
          certificateIssuedAt: true,
          certificateFileName: true,
          certificateFileMimeType: true,
          fileUploadedAt: true,
          issuedAt: true,
          validUntil: true,
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

/*
 * ---------- Farmer learning path ----------
 */

export async function startSeminarModule(userId: string, moduleId: string) {
  return prisma.$transaction(async (transaction) => {
    const customer = requireProfile(
      await getActiveProfileForUser(transaction, userId)
    );

    const module = await transaction.seminarModule.findFirst({
      where: { id: moduleId, isPublished: true, archivedAt: null },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    // Upsert keeps this idempotent: one enrollment per customer per
    // module, restarts just refresh lastAccessedAt.
    return transaction.seminarEnrollment.upsert({
      where: {
        customerProfileId_moduleId: {
          customerProfileId: customer.id,
          moduleId: module.id,
        },
      },
      create: {
        customerProfileId: customer.id,
        moduleId: module.id,
      },
      update: { lastAccessedAt: new Date() },
    });
  });
}

export async function updateSeminarVideoProgress(
  userId: string,
  videoId: string,
  progressPercent: number
) {
  return prisma.$transaction(async (transaction) => {
    const customer = requireProfile(
      await getActiveProfileForUser(transaction, userId)
    );

    const video = await transaction.seminarVideo.findUnique({
      where: { id: videoId },
      include: {
        module: {
          select: { id: true, moduleNumber: true, price: true, isPublished: true },
        },
      },
    });

    // Archived videos are removed content: no new progress on them.
    if (!video || video.archivedAt || !video.module.isPublished) {
      throw new HttpError(404, "Seminar video was not found.");
    }

    // Locked-module content rejects direct API calls too: the previous
    // module must be completed AND a paid module must be owned.
    await assertModuleContentAccessible(transaction, customer.id, video.module);

    const enrollment = await transaction.seminarEnrollment.upsert({
      where: {
        customerProfileId_moduleId: {
          customerProfileId: customer.id,
          moduleId: video.moduleId,
        },
      },
      create: {
        customerProfileId: customer.id,
        moduleId: video.moduleId,
      },
      update: { lastAccessedAt: new Date() },
    });

    /*
     * Progress never moves backwards: a stale or replayed request with a
     * lower percentage keeps the highest value already reached, and a
     * finished video keeps its original completedAt.
     */
    const existingProgress = await transaction.seminarProgress.findUnique({
      where: {
        enrollmentId_videoId: {
          enrollmentId: enrollment.id,
          videoId: video.id,
        },
      },
    });

    const safeProgressPercent = existingProgress
      ? Math.max(existingProgress.progressPercent, progressPercent)
      : progressPercent;

    const progress = await transaction.seminarProgress.upsert({
      where: {
        enrollmentId_videoId: {
          enrollmentId: enrollment.id,
          videoId: video.id,
        },
      },
      create: {
        enrollmentId: enrollment.id,
        videoId: video.id,
        progressPercent: safeProgressPercent,
        completedAt: safeProgressPercent === 100 ? new Date() : null,
      },
      update: {
        progressPercent: safeProgressPercent,
        completedAt:
          safeProgressPercent === 100
            ? (existingProgress?.completedAt ?? new Date())
            : null,
      },
    });

    const moduleCompleted = await recalculateEnrollmentCompletion(
      transaction,
      enrollment.id,
      { userId }
    );

    return { progress, moduleCompleted };
  });
}

/*
 * The quiz payload a farmer receives: questions and choices WITHOUT
 * isCorrect. The select below is the only defense a browser ever sees.
 * Locked modules (prerequisite or unpaid purchase) reject the read.
 */
export async function getQuizForModule(userId: string, moduleId: string) {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  const module = await prisma.seminarModule.findFirst({
    where: { id: moduleId, isPublished: true, archivedAt: null },
    select: {
      id: true,
      moduleNumber: true,
      title: true,
      passingScore: true,
      price: true,
      questions: {
        where: { isActive: true },
        select: {
          id: true,
          questionText: true,
          points: true,
          displayOrder: true,
          choices: {
            select: {
              id: true,
              choiceText: true,
              displayOrder: true,
            },
            orderBy: { displayOrder: "asc" },
          },
        },
        orderBy: { displayOrder: "asc" },
      },
    },
  });

  if (!module) {
    throw new HttpError(404, "Seminar module was not found.");
  }

  await assertModuleContentAccessible(prisma, customer.id, module);
  // A finished seminar inside its 2-year window never serves its exam
  // again — the certificate is retrieved, not re-earned.
  await assertQuizRetakeAllowed(prisma, customer.id, module);

  if (module.questions.length === 0) {
    throw new HttpError(404, "This seminar module does not have a quiz yet.");
  }

  // price was loaded only for the access check — it is not quiz content.
  const { price: _price, ...quiz } = module;
  return quiz;
}

export async function submitSeminarQuiz(
  userId: string,
  moduleId: string,
  submittedAnswers: QuizAnswerInput[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const customer = requireProfile(
      await getActiveProfileForUser(transaction, userId)
    );

    const module = await transaction.seminarModule.findFirst({
      where: { id: moduleId, isPublished: true, archivedAt: null },
      include: {
        questions: {
          where: { isActive: true },
          include: { choices: true },
          orderBy: { displayOrder: "asc" },
        },
      },
    });

    if (!module) {
      throw new HttpError(404, "Seminar module was not found.");
    }

    // Same lock as the quiz read: scoring a locked module is content
    // access, whatever route the request took to get here.
    await assertModuleContentAccessible(transaction, customer.id, module);
    // Same closed-exam rule as the quiz read, so a hand-made POST cannot
    // put an already-earned completion back on the line.
    await assertQuizRetakeAllowed(transaction, customer.id, module);

    if (module.questions.length === 0) {
      throw new HttpError(409, "This seminar module does not have a quiz yet.");
    }

    /*
     * A submission must cover every quiz question exactly once, and
     * every selected choice must belong to its own question — no
     * skipping half the quiz, no duplicated questions, no cross-wired
     * choice IDs.
     */
    const uniqueQuestionIds = new Set(
      submittedAnswers.map((answer) => answer.questionId)
    );

    if (
      submittedAnswers.length !== module.questions.length ||
      uniqueQuestionIds.size !== submittedAnswers.length
    ) {
      throw new HttpError(
        400,
        "Submitted answers must cover every quiz question exactly once."
      );
    }

    const enrollment = await transaction.seminarEnrollment.upsert({
      where: {
        customerProfileId_moduleId: {
          customerProfileId: customer.id,
          moduleId: module.id,
        },
      },
      create: {
        customerProfileId: customer.id,
        moduleId: module.id,
      },
      update: { lastAccessedAt: new Date() },
    });

    /*
     * Scoring is entirely server-side: the request only contains choice
     * IDs, never scores or pass flags.
     */
    const answerMap = new Map(
      submittedAnswers.map((answer) => [answer.questionId, answer.choiceId])
    );

    let score = 0;
    let totalScore = 0;

    const storedAnswers: {
      questionId: string;
      choiceId: string;
      correct: boolean;
    }[] = [];

    for (const question of module.questions) {
      totalScore += question.points;

      const selectedChoiceId = answerMap.get(question.id);

      if (selectedChoiceId === undefined) {
        throw new HttpError(
          400,
          "Submitted answers must cover every quiz question exactly once."
        );
      }

      const selectedChoice = question.choices.find(
        (choice) => choice.id === selectedChoiceId
      );

      if (!selectedChoice) {
        throw new HttpError(
          400,
          "One or more answers do not match this quiz's questions and choices."
        );
      }

      const correct = selectedChoice.isCorrect === true;
      if (correct) score += question.points;

      storedAnswers.push({
        questionId: question.id,
        choiceId: selectedChoice.id,
        correct,
      });
    }

    const percentage = totalScore === 0 ? 0 : (score / totalScore) * 100;
    const passed = percentage >= module.passingScore;

    const attempt = await transaction.quizAttempt.create({
      data: {
        enrollmentId: enrollment.id,
        score,
        totalScore,
        percentage: new Prisma.Decimal(percentage.toFixed(2)),
        passed,
        answers: storedAnswers as Prisma.InputJsonValue,
      },
    });

    const moduleCompleted = await recalculateEnrollmentCompletion(
      transaction,
      enrollment.id,
      { userId, meta }
    );

    await recordActivity(transaction, {
      userId,
      module: "SEMINARS",
      action: "SEMINAR_QUIZ_SUBMITTED",
      description: `Quiz for Seminar Module ${module.moduleNumber} was submitted (${passed ? "passed" : "failed"}).`,
      recordType: "QuizAttempt",
      recordId: attempt.id,
      metadata: { score, totalScore, percentage, passed, moduleCompleted },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      attemptId: attempt.id,
      score,
      totalScore,
      percentage: Number(percentage.toFixed(2)),
      passingScore: module.passingScore,
      passed,
      moduleCompleted,
    };
  });
}

export async function getMySeminarProgress(userId: string) {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  /*
   * Three independent reads, issued together. Every query here crosses
   * the Cloud SQL proxy (~100ms each), so awaiting them one after
   * another was most of this endpoint's response time — none of them
   * needs another's result, only the profile id.
   *
   *   modules    — catalog + this farmer's enrollments/progress/attempts
   *   purchases  — seminar orders, for the same access rule the content
   *                gate applies, so the UI can only show what the API allows
   *   completion — the whole-seminar cycle: whether Modules 1-3 are done,
   *                which certificate that earned, how long it stands
   */
  const [modules, purchases, completion] = await Promise.all([
    prisma.seminarModule.findMany({
      where: { isPublished: true, archivedAt: null },
      include: {
        videos: { where: { archivedAt: null }, select: { id: true } },
        enrollments: {
          where: { customerProfileId: customer.id },
          include: {
            progress: { select: { videoId: true, progressPercent: true } },
            quizAttempts: {
              select: {
                id: true,
                score: true,
                totalScore: true,
                percentage: true,
                passed: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
      orderBy: { moduleNumber: "asc" },
    }),
    getSeminarPurchaseMap(prisma, customer.id),
    getSeminarCompletionState(prisma, customer.id),
  ]);

  const completedModuleIds = new Set(
    modules
      .filter((module) => module.enrollments[0]?.completedAt != null)
      .map((module) => module.id)
  );
  const accessStates = computeSequentialAccess(
    modules,
    completedModuleIds,
    purchases
  );

  const moduleProgress = modules.map((module) => {
    const enrollment = module.enrollments[0] ?? null;
    const totalVideos = module.videos.length;
    const completedVideos =
      enrollment?.progress.filter((entry) => entry.progressPercent === 100)
        .length ?? 0;
    const bestAttempt =
      enrollment?.quizAttempts.reduce<
        (typeof enrollment.quizAttempts)[number] | null
      >(
        (best, attempt) =>
          !best || Number(attempt.percentage) > Number(best.percentage)
            ? attempt
            : best,
        null
      ) ?? null;

    const access = accessStates.get(module.id)!;
    const purchaseStatus: SeminarPurchaseStatus = access.isFree
      ? "NOT_REQUIRED"
      : access.purchase?.owned
        ? "OWNED"
        : access.purchase?.pending
          ? "PENDING"
          : "NOT_PURCHASED";

    return {
      moduleId: module.id,
      moduleNumber: module.moduleNumber,
      title: module.title,
      passingScore: module.passingScore,
      started: enrollment !== null,
      startedAt: enrollment?.startedAt ?? null,
      completedAt: enrollment?.completedAt ?? null,
      totalVideos,
      completedVideos,
      quizAttemptCount: enrollment?.quizAttempts.length ?? 0,
      quizPassed:
        enrollment?.quizAttempts.some((attempt) => attempt.passed) ?? false,
      bestAttempt,
      /* ---- Pricing + purchase-gated access (spec: paid modules) ---- */
      price: module.price,
      isFree: access.isFree,
      purchaseStatus,
      purchaseOrderId: access.purchase?.orderId ?? null,
      purchaseOrderNumber: access.purchase?.orderNumber ?? null,
      prerequisiteCompleted: access.prerequisiteCompleted,
      prerequisiteModuleNumber: access.prerequisiteModuleNumber,
      accessible: access.accessible,
      /* Persistent completion + the closed-exam verdict this module's
         quiz endpoints actually enforce. */
      completed: enrollment?.completedAt != null,
      retakeLocked:
        enrollment?.completedAt != null &&
        REQUIRED_MODULE_NUMBERS.includes(module.moduleNumber) &&
        completion.retakeLocked,
    };
  });

  /*
   * Counted from raw enrollments (not the visible module list) so a
   * completed-then-archived required module keeps counting — this must
   * always agree with the real Parent Stock gate in order.service.
   * getSeminarCompletionState already counted exactly those rows, so it
   * is reused here instead of repeating the same query.
   */
  const completedRequiredModules = completion.completedRequiredModules;

  return {
    customerNumber: customer.customerNumber,
    modules: moduleProgress,
    completedRequiredModules,
    requiredModuleNumbers: REQUIRED_MODULE_NUMBERS,
    parentStockUnlocked:
      completedRequiredModules === REQUIRED_MODULE_NUMBERS.length,
    /* Whole-seminar state: completion, the earned certificate and the
       2-year window — so a refresh, a new device or a fresh login all
       recognize the finished seminar without another exam attempt. */
    seminarCompletion: completion,
  };
}

/*
 * ---------- Certificates ----------
 */

export async function requestSeminarCertificate(
  userId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const customer = requireProfile(
      await getActiveProfileForUser(transaction, userId)
    );

    const completed = await countCompletedRequiredModules(
      transaction,
      customer.id
    );

    if (completed !== REQUIRED_MODULE_NUMBERS.length) {
      throw new HttpError(
        409,
        "Certificate requests require completing Seminar Modules 1, 2, and 3 first."
      );
    }

    const existing = await transaction.certificateRequest.findFirst({
      where: {
        customerProfileId: customer.id,
        status: { in: ["PENDING", "APPROVED"] },
      },
    });

    if (existing) {
      throw new HttpError(
        409,
        "A certificate request is already pending or approved for this account."
      );
    }

    const request = await transaction.certificateRequest.create({
      data: { customerProfileId: customer.id },
    });

    await recordActivity(transaction, {
      userId,
      module: "SEMINARS",
      action: "CERTIFICATE_REQUESTED",
      description: `Customer ${customer.customerNumber} requested a Seminar Certificate of Attendance.`,
      recordType: "CertificateRequest",
      recordId: request.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return request;
  });
}

export async function getMyCertificateRequests(userId: string) {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  const requests = await prisma.certificateRequest.findMany({
    where: { customerProfileId: customer.id },
    orderBy: { requestedAt: "desc" },
  });

  return {
    customerNumber: customer.customerNumber,
    /*
     * Farmer-safe shape: the stored file path and staff user IDs never
     * leave the server. hasCertificateFile + validityStatus are derived
     * here so every client shares one formula.
     */
    requests: requests.map(
      ({
        certificateFilePath,
        fileUploadedByUserId,
        issuedByUserId,
        reviewedByUserId,
        ...safe
      }) => ({
        ...safe,
        hasCertificateFile: certificateFilePath !== null,
        validityStatus: certificateValidityStatus(
          safe.issuedAt,
          safe.validUntil
        ),
      })
    ),
  };
}

export async function getCertificateRequests(
  status?: "PENDING" | "APPROVED" | "REJECTED"
) {
  return prisma.certificateRequest.findMany({
    where: status ? { status } : undefined,
    include: {
      customerProfile: {
        select: {
          id: true,
          customerNumber: true,
          firstName: true,
          lastName: true,
          contactEmail: true,
        },
      },
      reviewedBy: {
        select: { id: true, email: true },
      },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function reviewCertificateRequest(
  actorUserId: string,
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  notes: string | null,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const request = await transaction.certificateRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new HttpError(404, "Certificate request was not found.");
    }

    if (request.status !== "PENDING") {
      throw new HttpError(
        409,
        `This certificate request has already been ${request.status.toLowerCase()}.`
      );
    }

    let certificateNumber: string | null = null;

    if (decision === "APPROVED") {
      certificateNumber = await nextCertificateNumber(transaction);
    }

    const reviewed = await transaction.certificateRequest.update({
      where: { id: request.id },
      data: {
        status: decision,
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        reviewNotes: notes,
        certificateNumber,
        certificateIssuedAt: decision === "APPROVED" ? new Date() : null,
      },
      include: {
        customerProfile: {
          select: {
            userId: true,
            customerNumber: true,
            firstName: true,
            lastName: true,
          },
        },
        reviewedBy: {
          select: { id: true, email: true },
        },
      },
    });

    await recordActivity(transaction, {
      userId: actorUserId,
      module: "SEMINARS",
      action:
        decision === "APPROVED"
          ? "CERTIFICATE_APPROVED"
          : "CERTIFICATE_REJECTED",
      description: `Seminar certificate request was ${decision.toLowerCase()}.`,
      recordType: "CertificateRequest",
      recordId: request.id,
      metadata: certificateNumber ? { certificateNumber } : undefined,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    // The farmer hears about the approval (historical profiles without
    // a linked account have nobody to notify).
    if (decision === "APPROVED" && reviewed.customerProfile.userId) {
      await notifyUser(transaction, reviewed.customerProfile.userId, {
        type: "CERTIFICATE_APPROVED",
        title: "Seminar certificate approved",
        message: `Your seminar certificate ${certificateNumber} has been approved and issued.`,
        recordType: "CertificateRequest",
        recordId: request.id,
      });
    }

    return reviewed;
  });
}

/*
 * ---------- Stored certificate files ----------
 *
 * DACS generates the Certificate of Attendance automatically the moment
 * Modules 1-3 are complete (autoIssueSeminarCertificate above), so there
 * is no staff upload/replace/issue step: the certificate every client
 * renders is built from the record itself — the account's name, its SEM
 * number and its issue date on the shared template.
 *
 * A certificate_requests row may still carry a file from the retired
 * manual workflow. Those files are kept and stay downloadable through
 * the authenticated endpoints below; they live under
 * PRIVATE_UPLOADS_ROOT/dacs-certificates and are never exposed on the
 * public /uploads route.
 */

export interface CertificateFilePayload {
  absolutePath: string;
  mimeType: string;
  fileName: string;
}

function toCertificateFilePayload(row: {
  certificateFilePath: string | null;
  certificateFileMimeType: string | null;
  certificateFileName: string | null;
  certificateNumber: string | null;
  id: string;
}): CertificateFilePayload {
  const absolutePath = row.certificateFilePath
    ? resolvePrivateFile(row.certificateFilePath)
    : null;

  if (!absolutePath) {
    /* Auto-generated certificates carry no stored file — clients render
       them from the record instead (name + SEM number + issue date). */
    throw new HttpError(404, "This certificate has no stored file.");
  }

  return {
    absolutePath,
    mimeType: row.certificateFileMimeType ?? "application/octet-stream",
    fileName:
      row.certificateFileName ??
      `dacs-certificate-${row.certificateNumber ?? row.id}`,
  };
}

/* Staff can open any uploaded certificate file (pre- or post-issue). */
export async function getCertificateFileForStaff(
  requestId: string
): Promise<CertificateFilePayload> {
  const request = await prisma.certificateRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      certificateFilePath: true,
      certificateFileMimeType: true,
      certificateFileName: true,
      certificateNumber: true,
    },
  });

  if (!request) {
    throw new HttpError(404, "Certificate request was not found.");
  }

  return toCertificateFilePayload(request);
}

/*
 * Farmer download: ownership is enforced by scoping the lookup to the
 * caller's own profile (a foreign ID reads as "not found", never as a
 * hint that someone else's certificate exists), and nothing is served
 * before staff have ISSUED the certificate. Expired certificates stay
 * downloadable — the account keeps its certification history.
 */
export async function getMyCertificateFile(
  userId: string,
  requestId: string
): Promise<CertificateFilePayload> {
  const customer = requireProfile(
    await getActiveProfileForUser(prisma, userId)
  );

  const request = await prisma.certificateRequest.findFirst({
    where: { id: requestId, customerProfileId: customer.id },
    select: {
      id: true,
      issuedAt: true,
      certificateFilePath: true,
      certificateFileMimeType: true,
      certificateFileName: true,
      certificateNumber: true,
    },
  });

  if (!request) {
    throw new HttpError(404, "Certificate was not found.");
  }

  if (!request.issuedAt) {
    throw new HttpError(404, "This certificate has not been issued yet.");
  }

  return toCertificateFilePayload(request);
}
