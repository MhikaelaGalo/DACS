import type { NextFunction, Request, Response } from "express";

import { deleteFileByUrl, saveFile } from "../../services/fileStorage.service";
import { HttpError } from "../../utils/httpError";
import { detectImageType, detectVideoType } from "../../utils/imageType";
import {
  optionalString,
  rejectUnexpectedFields,
  requiredString,
  requiredUuid,
} from "../../utils/validation";
import {
  addSeminarQuestion,
  addSeminarVideo,
  createSeminarModule,
  deleteSeminarModule,
  deleteSeminarQuestion,
  deleteSeminarVideo,
  getCertificateFileForStaff,
  getCertificateRequests,
  getMyCertificateFile,
  getMyCertificateRequests,
  getMySeminarProgress,
  getQuizForModule,
  getSeminarModuleDetail,
  getSeminarModules,
  getSeminarProgressOverview,
  requestSeminarCertificate,
  reviewCertificateRequest,
  reorderSeminarVideos,
  startSeminarModule,
  submitSeminarQuiz,
  updateSeminarCertificateTemplate,
  updateSeminarCoverImage,
  updateSeminarModule,
  updateSeminarQuestion,
  updateSeminarVideo,
  updateSeminarVideoProgress,
  type CertificateFilePayload,
  type CreateQuestionInput,
  type QuizAnswerInput,
  type UpdateModuleInput,
  type UpdateQuestionInput,
  type UpdateVideoInput,
} from "./seminar.service";

const MODULE_FIELDS = [
  "moduleNumber",
  "title",
  "description",
  "passingScore",
  "isPublished",
  "price",
] as const;

const VIDEO_FIELDS = [
  "title",
  "videoUrl",
  "description",
  "displayOrder",
  "durationSeconds",
] as const;

/*
 * Multipart text fields always arrive as strings; JSON bodies carry
 * real numbers. Coerce numeric-looking strings so both paths share the
 * same integer validators.
 */
function coerceNumeric(value: unknown): unknown {
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
}

const QUESTION_FIELDS = [
  "questionText",
  "points",
  "displayOrder",
  "choices",
] as const;

const CHOICE_FIELDS = ["choiceText", "isCorrect", "displayOrder"] as const;

/* Question edits may send each choice's existing id to keep it. */
const UPDATE_CHOICE_FIELDS = [
  "id",
  "choiceText",
  "isCorrect",
  "displayOrder",
] as const;

const CERTIFICATE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

function requirePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive whole number.`, field);
  }
  return value;
}

function requirePassingScore(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new HttpError(
      400,
      "Passing score must be a whole number between 0 and 100."
    );
  }
  return value;
}

/*
 * Module access price in pesos: 0 = free. Same bounds as staff-entered
 * order money (Decimal(12,2) columns); at most centavo precision so the
 * value survives the money representation exactly.
 */
const MAX_MODULE_PRICE = 9_999_999.99;

function requireModulePrice(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_MODULE_PRICE ||
    Math.round(value * 100) !== value * 100
  ) {
    throw new HttpError(
      400,
      `Module price must be a number between 0 and ${MAX_MODULE_PRICE} with at most two decimal places.`,
      "price"
    );
  }
  return value;
}

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

/*
 * ---------- Staff content management ----------
 */

export async function createModule(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, MODULE_FIELDS);

    if (raw.isPublished !== undefined) {
      throw new HttpError(
        400,
        "New modules start unpublished; publish them with PATCH once content is ready."
      );
    }

    const module = await createSeminarModule(
      actor.id,
      {
        moduleNumber: requirePositiveInteger(raw.moduleNumber, "Module number"),
        title: requiredString(raw.title, "Module title", 150),
        description: optionalString(raw.description, "Description", 1000),
        passingScore: requirePassingScore(raw.passingScore),
        // New modules are free unless staff set a price.
        ...(raw.price !== undefined
          ? { price: requireModulePrice(raw.price) }
          : {}),
      },
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.status(201).json({
      success: true,
      message: "Seminar module was created successfully.",
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function editModule(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, MODULE_FIELDS);

    if (raw.moduleNumber !== undefined) {
      throw new HttpError(
        400,
        "The module number cannot be changed after creation."
      );
    }

    const input: UpdateModuleInput = {};

    if (raw.title !== undefined) {
      input.title = requiredString(raw.title, "Module title", 150);
    }

    if (raw.description !== undefined) {
      input.description = optionalString(raw.description, "Description", 1000);
    }

    if (raw.passingScore !== undefined) {
      input.passingScore = requirePassingScore(raw.passingScore);
    }

    if (raw.price !== undefined) {
      input.price = requireModulePrice(raw.price);
    }

    if (raw.isPublished !== undefined) {
      if (typeof raw.isPublished !== "boolean") {
        throw new HttpError(400, "isPublished must be true or false.");
      }
      input.isPublished = raw.isPublished;
    }

    const module = await updateSeminarModule(actor.id, moduleId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Seminar module was updated successfully.",
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function addVideo(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, VIDEO_FIELDS);

    /*
     * Two ways in: a real video upload (multipart field "video" — the
     * admin frontend's Add Video dialog) or a JSON body carrying a
     * videoUrl for externally hosted videos. Exactly one of the two.
     */
    const file = request.file;
    let videoUrl: string;
    let fileName: string | null = null;
    let savedUrl: string | null = null;

    if (file) {
      if (raw.videoUrl !== undefined) {
        throw new HttpError(
          400,
          "Provide either a video file or a video URL, not both.",
          "videoUrl"
        );
      }

      const detected = detectVideoType(file.buffer);
      if (!detected) {
        throw new HttpError(
          400,
          "Only MP4 or WebM video files can be uploaded."
        );
      }

      const safeName = file.originalname.replace(/[^\w.-]+/g, "_");
      savedUrl = await saveFile(
        "seminar-videos",
        `video-${Date.now()}-${safeName}`,
        file.buffer
      );
      videoUrl = savedUrl;
      fileName = file.originalname;
    } else {
      videoUrl = requiredString(raw.videoUrl, "Video URL", 500);
    }

    try {
      const durationRaw = coerceNumeric(raw.durationSeconds);
      const displayOrderRaw = coerceNumeric(raw.displayOrder);

      const video = await addSeminarVideo(
        actor.id,
        moduleId,
        {
          title: requiredString(raw.title, "Video title", 150),
          videoUrl,
          description: optionalString(raw.description, "Description", 1000),
          displayOrder:
            displayOrderRaw === undefined
              ? 1
              : requirePositiveInteger(displayOrderRaw, "Display order"),
          durationSeconds:
            durationRaw === undefined || durationRaw === null
              ? null
              : requirePositiveInteger(durationRaw, "Duration"),
          fileName,
        },
        { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
      );

      response.status(201).json({
        success: true,
        message: "Seminar video was added successfully.",
        data: video,
      });
    } catch (error) {
      /* Never leave an orphaned file when the database write failed. */
      if (savedUrl) {
        await deleteFileByUrl(savedUrl);
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
}

/* Staff seminar-progress overview (admin monitoring table). */
export async function getProgressOverview(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const records = await getSeminarProgressOverview();

    response.json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Staff module detail: full editing payload (videos + questions with
 * isCorrect). Farmers never reach this route — their quiz payload is
 * answer-stripped.
 */
export async function getModuleDetail(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const module = await getSeminarModuleDetail(moduleId);

    response.json({
      success: true,
      data: module,
    });
  } catch (error) {
    next(error);
  }
}

export async function addQuestion(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, QUESTION_FIELDS);

    if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
      throw new HttpError(400, "A question needs a list of choices.", "choices");
    }

    const choices: CreateQuestionInput["choices"] = [];

    for (const [index, rawChoice] of raw.choices.entries()) {
      if (
        typeof rawChoice !== "object" ||
        rawChoice === null ||
        Array.isArray(rawChoice)
      ) {
        throw new HttpError(400, "Every choice must be a valid object.", "choices");
      }

      const choice = rawChoice as Record<string, unknown>;
      rejectUnexpectedFields(choice, CHOICE_FIELDS);

      if (typeof choice.isCorrect !== "boolean") {
        throw new HttpError(400, "Every choice needs isCorrect true or false.");
      }

      choices.push({
        choiceText: requiredString(choice.choiceText, "Choice text", 300),
        isCorrect: choice.isCorrect,
        displayOrder:
          choice.displayOrder === undefined
            ? index + 1
            : requirePositiveInteger(choice.displayOrder, "Choice display order"),
      });
    }

    const question = await addSeminarQuestion(
      actor.id,
      moduleId,
      {
        questionText: requiredString(raw.questionText, "Question text", 500),
        points:
          raw.points === undefined
            ? 1
            : requirePositiveInteger(raw.points, "Points"),
        displayOrder:
          raw.displayOrder === undefined
            ? 1
            : requirePositiveInteger(raw.displayOrder, "Display order"),
        choices,
      },
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.status(201).json({
      success: true,
      message: "Quiz question was added successfully.",
      data: question,
    });
  } catch (error) {
    next(error);
  }
}

export async function editVideo(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const videoId = requiredUuid(request.params.videoId, "The video ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    // displayOrder is deliberately absent: ordering changes go through
    // the atomic reorder endpoint, never through single-video edits.
    rejectUnexpectedFields(raw, ["title", "videoUrl", "description"]);

    const input: UpdateVideoInput = {};

    if (raw.title !== undefined) {
      input.title = requiredString(raw.title, "Video title", 150);
    }

    if (raw.videoUrl !== undefined) {
      input.videoUrl = requiredString(raw.videoUrl, "Video URL", 500);
    }

    if (raw.description !== undefined) {
      input.description = optionalString(raw.description, "Description", 1000);
    }

    const video = await updateSeminarVideo(actor.id, moduleId, videoId, input, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: "Seminar video was updated successfully.",
      data: video,
    });
  } catch (error) {
    next(error);
  }
}

export async function reorderVideos(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["orderedVideoIds"]);

    if (!Array.isArray(raw.orderedVideoIds) || raw.orderedVideoIds.length === 0) {
      throw new HttpError(
        400,
        "orderedVideoIds must be a list of video IDs.",
        "orderedVideoIds"
      );
    }

    const orderedVideoIds = raw.orderedVideoIds.map((value) =>
      requiredUuid(value, "Every entry in orderedVideoIds")
    );

    const videos = await reorderSeminarVideos(
      actor.id,
      moduleId,
      orderedVideoIds,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message: "Seminar videos were reordered successfully.",
      count: videos.length,
      data: videos,
    });
  } catch (error) {
    next(error);
  }
}

export async function editQuestion(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const questionId = requiredUuid(request.params.questionId, "The question ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["questionText", "points", "choices"]);

    const input: UpdateQuestionInput = {};

    if (raw.questionText !== undefined) {
      input.questionText = requiredString(raw.questionText, "Question text", 500);
    }

    if (raw.points !== undefined) {
      input.points = requirePositiveInteger(raw.points, "Points");
    }

    if (raw.choices !== undefined) {
      if (!Array.isArray(raw.choices) || raw.choices.length === 0) {
        throw new HttpError(400, "A question needs a list of choices.", "choices");
      }

      const choices: NonNullable<UpdateQuestionInput["choices"]> = [];

      for (const [index, rawChoice] of raw.choices.entries()) {
        if (
          typeof rawChoice !== "object" ||
          rawChoice === null ||
          Array.isArray(rawChoice)
        ) {
          throw new HttpError(400, "Every choice must be a valid object.", "choices");
        }

        const choice = rawChoice as Record<string, unknown>;
        rejectUnexpectedFields(choice, UPDATE_CHOICE_FIELDS);

        if (typeof choice.isCorrect !== "boolean") {
          throw new HttpError(400, "Every choice needs isCorrect true or false.");
        }

        choices.push({
          ...(choice.id !== undefined
            ? { id: requiredUuid(choice.id, "Every choice ID") }
            : {}),
          choiceText: requiredString(choice.choiceText, "Choice text", 300),
          isCorrect: choice.isCorrect,
          displayOrder:
            choice.displayOrder === undefined
              ? index + 1
              : requirePositiveInteger(choice.displayOrder, "Choice display order"),
        });
      }

      input.choices = choices;
    }

    const question = await updateSeminarQuestion(
      actor.id,
      moduleId,
      questionId,
      input,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message: "Quiz question was updated successfully.",
      data: question,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Certificate-template upload mirrors the profile-image flow: multipart
 * "image" field, magic-byte type check, shared file storage, and the
 * replaced file deleted after a successful save.
 */
export async function uploadCertificateTemplate(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: 'A certificate template image is required in the "image" field.',
      });
      return;
    }

    const imageType = detectImageType(file.buffer);

    if (!imageType) {
      response.status(400).json({
        success: false,
        message: "Only JPEG, PNG, and WebP images are allowed.",
      });
      return;
    }

    const filename = `certificate-${moduleId}-${Date.now()}.${imageType.extension}`;
    const templateUrl = await saveFile(
      "certificate-templates",
      filename,
      file.buffer
    );

    let result;
    try {
      result = await updateSeminarCertificateTemplate(
        actor.id,
        moduleId,
        templateUrl,
        { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
      );
    } catch (error) {
      // The database update failed — don't leave an orphaned file behind.
      await deleteFileByUrl(templateUrl);
      throw error;
    }

    if (
      result.previousTemplateUrl &&
      result.previousTemplateUrl !== templateUrl
    ) {
      await deleteFileByUrl(result.previousTemplateUrl);
    }

    response.json({
      success: true,
      message: "Certificate template was updated successfully.",
      data: result.module,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Module cover-image upload (the customer-facing card artwork). Same
 * flow as the certificate template: multipart "image" field, magic-byte
 * type check, shared file storage, replaced file deleted after save.
 */
export async function uploadCoverImage(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const file = request.file;

    if (!file) {
      response.status(400).json({
        success: false,
        message: 'A cover image is required in the "image" field.',
      });
      return;
    }

    const imageType = detectImageType(file.buffer);

    if (!imageType) {
      response.status(400).json({
        success: false,
        message: "Only JPEG, PNG, and WebP images are allowed.",
      });
      return;
    }

    const filename = `cover-${moduleId}-${Date.now()}.${imageType.extension}`;
    const coverImageUrl = await saveFile("module-covers", filename, file.buffer);

    let result;
    try {
      result = await updateSeminarCoverImage(actor.id, moduleId, coverImageUrl, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
    } catch (error) {
      // The database update failed — don't leave an orphaned file behind.
      await deleteFileByUrl(coverImageUrl);
      throw error;
    }

    if (
      result.previousCoverImageUrl &&
      result.previousCoverImageUrl !== coverImageUrl
    ) {
      await deleteFileByUrl(result.previousCoverImageUrl);
    }

    response.json({
      success: true,
      message: "Module cover image was updated successfully.",
      data: result.module,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeCoverImage(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const result = await updateSeminarCoverImage(actor.id, moduleId, null, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    if (result.previousCoverImageUrl) {
      await deleteFileByUrl(result.previousCoverImageUrl);
    }

    response.json({
      success: true,
      message: "Module cover image was removed.",
      data: result.module,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * ---------- Staff deletion ----------
 */

export async function deleteModule(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const outcome = await deleteSeminarModule(actor.id, moduleId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    /* Hard delete: remove the uploaded video files and the certificate
       template too (best effort — deleteFileByUrl ignores
       non-/uploads/ URLs and missing files). */
    if (outcome.result === "DELETED") {
      if ("videoUrls" in outcome) {
        for (const url of outcome.videoUrls) {
          await deleteFileByUrl(url);
        }
      }
      if (outcome.module.certificateTemplateUrl) {
        await deleteFileByUrl(outcome.module.certificateTemplateUrl);
      }
      if (outcome.module.coverImageUrl) {
        await deleteFileByUrl(outcome.module.coverImageUrl);
      }
    }

    response.json({
      success: true,
      message:
        outcome.result === "DELETED"
          ? "Seminar module was permanently deleted."
          : `Seminar module was archived instead of deleted because ${outcome.enrollmentCount} farmer enrollment(s) reference it.`,
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteVideo(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const videoId = requiredUuid(request.params.videoId, "The video ID");

    const outcome = await deleteSeminarVideo(actor.id, moduleId, videoId, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    /* Hard delete: remove the uploaded file too (archived videos keep
       theirs — farmers' watch history references them). */
    if (outcome.result === "DELETED") {
      await deleteFileByUrl(outcome.video.videoUrl);
    }

    response.json({
      success: true,
      message:
        outcome.result === "DELETED"
          ? "Seminar video was permanently deleted."
          : `Seminar video was archived instead of deleted because ${outcome.progressCount} watch-progress record(s) reference it.`,
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

// Documented soft delete: the question is deactivated (isActive false),
// never removed, so historical quiz attempts stay intact.
export async function deleteQuestion(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const questionId = requiredUuid(request.params.questionId, "The question ID");

    const outcome = await deleteSeminarQuestion(
      actor.id,
      moduleId,
      questionId,
      { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
    );

    response.json({
      success: true,
      message:
        outcome.result === "ALREADY_INACTIVE"
          ? "Seminar question was already deactivated."
          : "Seminar question was deactivated (soft delete) — historical quiz attempts are preserved.",
      data: outcome,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * ---------- Module listing (staff see drafts, farmers see published) ----------
 */

export async function listModules(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const includeUnpublished =
      actor.role === "OWNER_EXECUTIVE" ||
      actor.role === "ADMINISTRATIVE_STAFF" ||
      actor.role === "IT_STAFF";

    // Farmers get locked modules' video URLs stripped; staff see all.
    const modules = await getSeminarModules(
      includeUnpublished,
      includeUnpublished ? undefined : actor.id
    );

    response.json({
      success: true,
      count: modules.length,
      data: modules,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * ---------- Farmer learning path ----------
 */

export async function startModule(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    const enrollment = await startSeminarModule(actor.id, moduleId);

    response.json({
      success: true,
      message: "Seminar module was started.",
      data: enrollment,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateVideoProgress(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const videoId = requiredUuid(request.params.videoId, "The video ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["progressPercent"]);

    if (
      typeof raw.progressPercent !== "number" ||
      !Number.isInteger(raw.progressPercent) ||
      raw.progressPercent < 0 ||
      raw.progressPercent > 100
    ) {
      throw new HttpError(
        400,
        "progressPercent must be a whole number between 0 and 100."
      );
    }

    const result = await updateSeminarVideoProgress(
      actor.id,
      videoId,
      raw.progressPercent
    );

    response.json({
      success: true,
      message: "Video progress was updated.",
      moduleCompleted: result.moduleCompleted,
      data: result.progress,
    });
  } catch (error) {
    next(error);
  }
}

export async function getModuleQuiz(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");
    // Locked modules (prerequisite / unpaid purchase) reject the read.
    const quiz = await getQuizForModule(actor.id, moduleId);

    response.json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
}

export async function submitModuleQuiz(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const moduleId = requiredUuid(request.params.moduleId, "The module ID");

    const raw = (request.body ?? {}) as Record<string, unknown>;
    rejectUnexpectedFields(raw, ["answers"]);

    if (!Array.isArray(raw.answers)) {
      throw new HttpError(400, "answers must be a list.", "answers");
    }

    const answers: QuizAnswerInput[] = [];

    for (const rawAnswer of raw.answers) {
      if (
        typeof rawAnswer !== "object" ||
        rawAnswer === null ||
        Array.isArray(rawAnswer)
      ) {
        throw new HttpError(400, "Every answer must be a valid object.", "answers");
      }

      const answer = rawAnswer as Record<string, unknown>;
      // Only IDs are accepted — never scores or pass flags.
      rejectUnexpectedFields(answer, ["questionId", "choiceId"]);

      answers.push({
        questionId: requiredUuid(answer.questionId, "Every answer's question ID"),
        choiceId: requiredUuid(answer.choiceId, "Every answer's choice ID"),
      });
    }

    const result = await submitSeminarQuiz(actor.id, moduleId, answers, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.json({
      success: true,
      message: result.passed
        ? "Quiz passed. Congratulations!"
        : "Quiz submitted, but the passing score was not reached.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getMyProgress(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const progress = await getMySeminarProgress(actor.id);

    response.json({
      success: true,
      data: progress,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * ---------- Certificates ----------
 */

export async function requestCertificate(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const certificateRequest = await requestSeminarCertificate(actor.id, {
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.status(201).json({
      success: true,
      message: "Certificate request was submitted successfully.",
      data: certificateRequest,
    });
  } catch (error) {
    next(error);
  }
}

export async function listMyCertificates(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const result = await getMyCertificateRequests(actor.id);

    response.json({
      success: true,
      customerNumber: result.customerNumber,
      count: result.requests.length,
      data: result.requests,
    });
  } catch (error) {
    next(error);
  }
}

export async function listCertificateRequests(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    let status: (typeof CERTIFICATE_STATUSES)[number] | undefined;

    if (request.query.status !== undefined) {
      if (
        typeof request.query.status !== "string" ||
        !CERTIFICATE_STATUSES.includes(
          request.query.status as (typeof CERTIFICATE_STATUSES)[number]
        )
      ) {
        throw new HttpError(400, "The certificate-status filter is not valid.");
      }

      status = request.query.status as (typeof CERTIFICATE_STATUSES)[number];
    }

    const requests = await getCertificateRequests(status);

    response.json({
      success: true,
      count: requests.length,
      filter: { status: status ?? null },
      data: requests,
    });
  } catch (error) {
    next(error);
  }
}

function reviewHandler(decision: "APPROVED" | "REJECTED") {
  return async (
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const actor = requireActor(request, response);
      if (!actor) return;

      const requestId = requiredUuid(
        request.params.requestId,
        "The certificate request ID"
      );

      const raw = (request.body ?? {}) as Record<string, unknown>;
      rejectUnexpectedFields(raw, ["notes"]);

      const reviewed = await reviewCertificateRequest(
        actor.id,
        requestId,
        decision,
        optionalString(raw.notes, "Notes", 500) ?? null,
        { ipAddress: request.ip, userAgent: request.headers["user-agent"] }
      );

      response.json({
        success: true,
        message: `Certificate request was ${decision.toLowerCase()} successfully.`,
        data: reviewed,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const approveCertificate = reviewHandler("APPROVED");
export const rejectCertificate = reviewHandler("REJECTED");

/*
 * ---------- Stored certificate files ----------
 *
 * Read-only: certificates are generated automatically when Modules 1-3
 * are completed, so there is no upload, replace or issue handler. These
 * endpoints only stream files left by the retired manual workflow.
 */

/*
 * Streams a stored certificate file. ?download=1 forces a save dialog;
 * the default inline disposition lets browsers preview PDFs and images.
 * The Content-Type comes from the stored magic-byte detection, never
 * from the request, and nosniff keeps browsers honest about it.
 */
function sendCertificateFile(
  request: Request,
  response: Response,
  next: NextFunction,
  payload: CertificateFilePayload
): void {
  const download =
    request.query.download === "1" || request.query.download === "true";

  /* ASCII fallback + RFC 5987 name so any original filename survives. */
  const asciiName =
    payload.fileName.replace(/[^ -~]+/g, "_").replace(/"/g, "'") ||
    "certificate";

  response.sendFile(
    payload.absolutePath,
    {
      headers: {
        "Content-Type": payload.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(payload.fileName)}`,
        "Cache-Control": "private, no-store",
      },
    },
    (error) => {
      if (!error) return;
      /* The database row exists but the disk file is gone/unreadable. */
      if (!response.headersSent) {
        next(new HttpError(404, "The certificate file is missing from storage."));
      }
    }
  );
}

export async function downloadCertificateFileStaff(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const requestId = requiredUuid(
      request.params.requestId,
      "The certificate request ID"
    );

    const payload = await getCertificateFileForStaff(requestId);
    sendCertificateFile(request, response, next, payload);
  } catch (error) {
    next(error);
  }
}

/* Farmer download of an ISSUED certificate they own (enforced in the
   service — foreign or unissued certificates read as 404). */
export async function downloadMyCertificateFile(
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actor = requireActor(request, response);
    if (!actor) return;

    const requestId = requiredUuid(
      request.params.requestId,
      "The certificate ID"
    );

    const payload = await getMyCertificateFile(actor.id, requestId);
    sendCertificateFile(request, response, next, payload);
  } catch (error) {
    next(error);
  }
}
