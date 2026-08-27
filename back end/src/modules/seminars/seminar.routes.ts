import { Router } from "express";

import { authenticateFirebase } from "../../middleware/authenticate";
import { authorizeRoles } from "../../middleware/authorizeRoles";
import { loadDacsUser } from "../../middleware/loadDacsUser";
import { requireVerifiedEmail } from "../../middleware/requireVerifiedEmail";
import { uploadLimiter } from "../../middleware/rateLimit";
import {
  uploadSingleImage,
  uploadSingleVideo,
} from "../../middleware/uploadImage";
import {
  addQuestion,
  addVideo,
  approveCertificate,
  createModule,
  deleteModule,
  deleteQuestion,
  deleteVideo,
  downloadCertificateFileStaff,
  downloadMyCertificateFile,
  editModule,
  editQuestion,
  editVideo,
  getModuleDetail,
  getModuleQuiz,
  getProgressOverview,
  getMyProgress,
  removeCoverImage,
  listCertificateRequests,
  listModules,
  listMyCertificates,
  rejectCertificate,
  reorderVideos,
  requestCertificate,
  startModule,
  submitModuleQuiz,
  updateVideoProgress,
  uploadCertificateTemplate,
  uploadCoverImage,
} from "./seminar.controller";

const seminarRouter = Router();

/*
 * Module listing: any active DACS user. Staff see drafts, farmers see
 * published modules only (decided in the controller).
 */
seminarRouter.get("/modules", authenticateFirebase, loadDacsUser, listModules);

/*
 * Staff content management. The module detail includes questions with
 * their correct answers, so it is never exposed to farmers (their quiz
 * payload is answer-stripped).
 */
seminarRouter.get(
  "/modules/:moduleId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getModuleDetail
);

// Staff monitoring: per-customer enrollment/completion overview.
seminarRouter.get(
  "/progress",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  getProgressOverview
);

seminarRouter.post(
  "/modules",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  createModule
);

seminarRouter.patch(
  "/modules/:moduleId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  editModule
);

// Accepts a multipart video upload (field "video") OR a JSON body with
// a videoUrl — multer passes non-multipart requests straight through.
seminarRouter.post(
  "/modules/:moduleId/videos",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  uploadLimiter,
  uploadSingleVideo("video"),
  addVideo
);

seminarRouter.post(
  "/modules/:moduleId/questions",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  addQuestion
);

/*
 * Staff content edits. The exact "/videos/reorder" path is registered
 * before "/videos/:videoId" so "reorder" is never treated as a video id.
 */
seminarRouter.patch(
  "/modules/:moduleId/videos/reorder",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  reorderVideos
);

seminarRouter.patch(
  "/modules/:moduleId/videos/:videoId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  editVideo
);

seminarRouter.patch(
  "/modules/:moduleId/questions/:questionId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  editQuestion
);

// PUT because a module has exactly one current certificate template;
// uploading a new one replaces (and deletes) the previous file.
seminarRouter.put(
  "/modules/:moduleId/certificate-template",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  uploadLimiter,
  uploadSingleImage("image"),
  uploadCertificateTemplate
);

/*
 * Module cover image (customer-facing card artwork). PUT replaces the
 * single current cover; DELETE removes it so the customer card falls
 * back to its neutral placeholder.
 */
seminarRouter.put(
  "/modules/:moduleId/cover-image",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  uploadLimiter,
  uploadSingleImage("image"),
  uploadCoverImage
);

seminarRouter.delete(
  "/modules/:moduleId/cover-image",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  removeCoverImage
);

/*
 * Staff deletion. History is never destroyed: modules with enrollments
 * and videos with watch progress are archived, questions are always
 * soft-deleted (isActive false).
 */
seminarRouter.delete(
  "/modules/:moduleId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  deleteModule
);

seminarRouter.delete(
  "/modules/:moduleId/videos/:videoId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  deleteVideo
);

seminarRouter.delete(
  "/modules/:moduleId/questions/:questionId",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  deleteQuestion
);

/*
 * Farmer learning path. Writes require a verified email, like every
 * other farmer write in DACS.
 */
seminarRouter.post(
  "/modules/:moduleId/start",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  startModule
);

seminarRouter.patch(
  "/videos/:videoId/progress",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  updateVideoProgress
);

// The quiz payload never contains isCorrect — answers stay server-side.
seminarRouter.get(
  "/modules/:moduleId/quiz",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  getModuleQuiz
);

seminarRouter.post(
  "/modules/:moduleId/quiz",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  submitModuleQuiz
);

seminarRouter.get(
  "/me/progress",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  getMyProgress
);

/*
 * Certificates. Exact paths ("/certificates/request", "/certificates/me")
 * are registered before "/certificates/:requestId/..." patterns.
 */
seminarRouter.post(
  "/certificates/request",
  authenticateFirebase,
  requireVerifiedEmail,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  requestCertificate
);

seminarRouter.get(
  "/certificates/me",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  listMyCertificates
);

/*
 * Farmer download of their own ISSUED certificate file. Ownership and
 * issuance are enforced in the service — the route never serves another
 * account's file, and nothing is downloadable before staff issue it.
 */
seminarRouter.get(
  "/certificates/me/:requestId/file",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("CLIENT_FARMER"),
  downloadMyCertificateFile
);

seminarRouter.get(
  "/certificates",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  listCertificateRequests
);

seminarRouter.patch(
  "/certificates/:requestId/approve",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  approveCertificate
);

seminarRouter.patch(
  "/certificates/:requestId/reject",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  rejectCertificate
);

/*
 * Staff read of a stored certificate file. Certificates are generated
 * automatically on completion, so there is no upload/replace/issue
 * route — this only streams files left by the retired manual workflow.
 */
seminarRouter.get(
  "/certificates/:requestId/file",
  authenticateFirebase,
  loadDacsUser,
  authorizeRoles("OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"),
  downloadCertificateFileStaff
);

export { seminarRouter };
