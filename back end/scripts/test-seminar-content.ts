/**
 * Seminar content-management verification for the admin integration:
 * the staff module-detail endpoint and real video file uploads.
 *
 *   - GET /api/seminars/modules/:moduleId — staff-only detail with
 *     questions INCLUDING isCorrect (farmers 403)
 *   - POST /modules/:moduleId/videos as multipart upload (field
 *     "video"): magic-byte validation (MP4/WebM only), stored file
 *     served from /uploads/seminar-videos, durationSeconds + fileName
 *     persisted
 *   - JSON videoUrl path still works alongside uploads
 *   - hard-deleting an uploaded video removes its stored file
 *   - module cover image (customer-card artwork): PUT/DELETE
 *     /modules/:moduleId/cover-image — magic-byte validation, stored
 *     file served from /uploads/module-covers, replace deletes the old
 *     file, removal nulls the column, drafts are never auto-published,
 *     covers on published modules set hasUnpublishedChanges, farmer
 *     list payload carries coverImageUrl + description
 *   - module description: PATCH persists, empty string clears to null
 *
 * Prerequisites: backend on :5000, staff seeded. Fixture: module 98
 * (hard-deleted at the end — it never gains enrollments).
 * Run: npx tsx scripts/test-seminar-content.ts
 */
import { assertTestServer } from "./lib/test-env";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const CREDENTIALS_FILE =
  "C:/Users/Ella Ignacio/DACS-secrets/admin-staff-credentials.txt";
const PROJECT_ID = "dacs-8f430";
const FIXTURE_MODULE_NUMBER = 98;
const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function record(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(
  pathName: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
    formData?: FormData;
  } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${BASE_URL}${pathName}`, {
    method: options.method ?? "GET",
    headers,
    body,
  });
  let parsed: any = null;
  try {
    parsed = await response.json();
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body: parsed };
}

async function getWebApiKey(): Promise<string> {
  if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
  const credential = applicationDefault();
  const accessToken = await credential.getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken.access_token}` };
  const appsResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps`,
    { headers }
  );
  const appsBody = (await appsResponse.json()) as { apps?: Array<{ name: string }> };
  const firstApp = appsBody.apps?.[0];
  if (!firstApp) throw new Error("No Firebase web app registered.");
  const configResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/${firstApp.name}/config`,
    { headers }
  );
  const config = (await configResponse.json()) as { apiKey?: string };
  if (!config.apiKey) throw new Error("Web app config has no apiKey.");
  return config.apiKey;
}

function loadPassword(email: string): string {
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (match && match[1].toLowerCase() === email.toLowerCase()) return match[2];
  }
  throw new Error(`No password for ${email} in ${CREDENTIALS_FILE}`);
}

async function signInWithPassword(
  apiKey: string,
  email: string,
  password: string
): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`Password sign-in failed for ${email}`);
  return body.idToken;
}

async function mintIdToken(apiKey: string, uid: string): Promise<string> {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  const customToken = await firebaseAuth.createCustomToken(uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("Could not mint ID token.");
  return body.idToken;
}

/* Smallest buffer that satisfies the MP4 magic check ("ftyp" at offset
   4) — the server validates the container signature, not playability. */
function fakeMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.alloc(64, 0x11),
  ]);
}

/* Buffers satisfying detectImageType's PNG / JPEG magic-byte checks. */
function fakePng(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(48, 0x33),
  ]);
}

function fakeJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(48, 0x55),
  ]);
}

function imageForm(bytes: Buffer, filename: string, type: string): FormData {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type }), filename);
  return form;
}

/* Filesystem path of a stored /uploads URL (honors UPLOADS_DIR). */
function storedFilePath(url: string): string {
  return path.resolve(
    process.cwd(),
    process.env.UPLOADS_DIR ?? "uploads",
    decodeURIComponent(new URL(url).pathname.replace(/^\/uploads\//, ""))
  );
}

async function cleanupFixture(): Promise<void> {
  const existing = await prisma.seminarModule.findUnique({
    where: { moduleNumber: FIXTURE_MODULE_NUMBER },
    select: { id: true, videos: { select: { videoUrl: true } } },
  });
  if (!existing) return;
  await prisma.seminarModule.delete({ where: { id: existing.id } });
}

async function main(): Promise<void> {
  console.log(`\nSeminar content verification against ${BASE_URL}\n`);
  await assertTestServer();
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");

  const apiKey = await getWebApiKey();
  const owner = await signInWithPassword(
    apiKey,
    "erwinjoseph.cruz@dominantasia.com",
    loadPassword("erwinjoseph.cruz@dominantasia.com")
  );
  let farmerUser;
  try {
    farmerUser = await firebaseAuth.getUserByEmail(FARMER_EMAIL);
  } catch {
    farmerUser = await firebaseAuth.createUser({
      email: FARMER_EMAIL,
      emailVerified: true,
    });
  }
  const farmer = await mintIdToken(apiKey, farmerUser.uid);
  await api("/api/auth/sync", { method: "POST", token: farmer });

  await cleanupFixture();

  // ---- Fixture module ------------------------------------------------------
  const created = await api("/api/seminars/modules", {
    method: "POST",
    token: owner,
    body: {
      moduleNumber: FIXTURE_MODULE_NUMBER,
      title: "Seminar Content Test Module",
      passingScore: 75,
    },
  });
  record("Create fixture module -> 201", created.status === 201);
  const moduleId: string = created.body?.data?.id;

  const question = await api(`/api/seminars/modules/${moduleId}/questions`, {
    method: "POST",
    token: owner,
    body: {
      questionText: "Sample question?",
      choices: [
        { choiceText: "Right", isCorrect: true },
        { choiceText: "Wrong", isCorrect: false },
      ],
    },
  });
  record("Add fixture question -> 201", question.status === 201);

  // ---- Staff module detail -------------------------------------------------
  const detail = await api(`/api/seminars/modules/${moduleId}`, { token: owner });
  const detailQuestion = detail.body?.data?.questions?.[0];
  record(
    "GET module detail (owner) -> 200 with questions incl. isCorrect",
    detail.status === 200 &&
      Array.isArray(detail.body?.data?.videos) &&
      detailQuestion?.choices?.some(
        (choice: { isCorrect?: boolean }) => choice.isCorrect === true
      ),
    `questions=${detail.body?.data?.questions?.length}`
  );

  const farmerDetail = await api(`/api/seminars/modules/${moduleId}`, {
    token: farmer,
  });
  record("GET module detail (farmer) -> 403", farmerDetail.status === 403);

  const badId = await api(`/api/seminars/modules/not-a-uuid`, { token: owner });
  record("GET module detail (bad id) -> 400", badId.status === 400);

  // ---- Video upload --------------------------------------------------------
  const uploadForm = new FormData();
  uploadForm.append(
    "video",
    new Blob([new Uint8Array(fakeMp4())], { type: "video/mp4" }),
    "Intro Lesson.mp4"
  );
  uploadForm.append("title", "Intro Lesson");
  uploadForm.append("durationSeconds", "754");
  uploadForm.append("displayOrder", "1");
  const uploaded = await api(`/api/seminars/modules/${moduleId}/videos`, {
    method: "POST",
    token: owner,
    formData: uploadForm,
  });
  const uploadedVideo = uploaded.body?.data;
  record(
    "Upload MP4 video -> 201 with stored URL + metadata",
    uploaded.status === 201 &&
      typeof uploadedVideo?.videoUrl === "string" &&
      uploadedVideo.videoUrl.includes("/uploads/seminar-videos/") &&
      uploadedVideo.durationSeconds === 754 &&
      uploadedVideo.fileName === "Intro Lesson.mp4",
    `url=${uploadedVideo?.videoUrl}`
  );

  const storedPath = uploadedVideo?.videoUrl
    ? path.resolve(
        process.cwd(),
        process.env.UPLOADS_DIR ?? "uploads",
        decodeURIComponent(
          new URL(uploadedVideo.videoUrl).pathname.replace(/^\/uploads\//, "")
        )
      )
    : "";
  record(
    "Uploaded file exists on disk",
    storedPath !== "" && existsSync(storedPath),
    storedPath
  );

  const served = await fetch(uploadedVideo.videoUrl);
  record("Stored video served via /uploads -> 200", served.status === 200);

  const garbageForm = new FormData();
  garbageForm.append(
    "video",
    new Blob([new Uint8Array(Buffer.alloc(32, 0x22))], { type: "video/mp4" }),
    "garbage.mp4"
  );
  garbageForm.append("title", "Garbage");
  const garbage = await api(`/api/seminars/modules/${moduleId}/videos`, {
    method: "POST",
    token: owner,
    formData: garbageForm,
  });
  record(
    "Upload non-video bytes -> 400",
    garbage.status === 400,
    garbage.body?.message
  );

  const jsonVideo = await api(`/api/seminars/modules/${moduleId}/videos`, {
    method: "POST",
    token: owner,
    body: {
      title: "External Video",
      videoUrl: "https://example.com/lesson.mp4",
      durationSeconds: 120,
      displayOrder: 2,
    },
  });
  record(
    "JSON videoUrl path still works -> 201",
    jsonVideo.status === 201 &&
      jsonVideo.body?.data?.videoUrl === "https://example.com/lesson.mp4" &&
      jsonVideo.body?.data?.durationSeconds === 120
  );

  const farmerUpload = await api(`/api/seminars/modules/${moduleId}/videos`, {
    method: "POST",
    token: farmer,
    body: { title: "Nope", videoUrl: "https://example.com/x.mp4" },
  });
  record("Farmer cannot add videos -> 403", farmerUpload.status === 403);

  // ---- List payload carries the new fields ---------------------------------
  const list = await api("/api/seminars/modules", { token: owner });
  const listModule = (list.body?.data ?? []).find(
    (entry: { id?: string }) => entry.id === moduleId
  );
  record(
    "List payload includes durationSeconds + fileName",
    listModule?.videos?.some(
      (video: { fileName?: string | null }) => video.fileName === "Intro Lesson.mp4"
    ) === true,
    `videos=${listModule?.videos?.length}`
  );

  // ---- Module cover image + description (customer-card content) ------------
  const coverUpload = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: owner,
    formData: imageForm(fakePng(), "cover.png", "image/png"),
  });
  const firstCoverUrl: string | undefined = coverUpload.body?.data?.coverImageUrl;
  record(
    "Upload PNG cover image -> 200 with stored URL",
    coverUpload.status === 200 &&
      typeof firstCoverUrl === "string" &&
      firstCoverUrl.includes("/uploads/module-covers/"),
    `url=${firstCoverUrl}`
  );
  record(
    "Cover upload does NOT auto-publish a draft module",
    coverUpload.body?.data?.isPublished === false
  );

  const firstCoverPath = firstCoverUrl ? storedFilePath(firstCoverUrl) : "";
  record(
    "Cover file exists on disk",
    firstCoverPath !== "" && existsSync(firstCoverPath),
    firstCoverPath
  );
  const coverServed = firstCoverUrl ? await fetch(firstCoverUrl) : null;
  record(
    "Stored cover served via /uploads -> 200",
    coverServed?.status === 200
  );

  const coverReplace = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: owner,
    formData: imageForm(fakeJpeg(), "cover2.jpg", "image/jpeg"),
  });
  const secondCoverUrl: string | undefined =
    coverReplace.body?.data?.coverImageUrl;
  record(
    "Replace cover -> 200 with a new .jpg URL",
    coverReplace.status === 200 &&
      typeof secondCoverUrl === "string" &&
      secondCoverUrl !== firstCoverUrl &&
      secondCoverUrl.endsWith(".jpg"),
    `url=${secondCoverUrl}`
  );
  record(
    "Replaced cover file removed from disk",
    firstCoverPath !== "" && !existsSync(firstCoverPath)
  );

  const badCover = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: owner,
    formData: imageForm(Buffer.alloc(24, 0x44), "bad.png", "image/png"),
  });
  record(
    "Upload non-image bytes as cover -> 400",
    badCover.status === 400,
    badCover.body?.message
  );

  const farmerCover = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: farmer,
    formData: imageForm(fakePng(), "farmer.png", "image/png"),
  });
  record("Farmer cannot upload a cover -> 403", farmerCover.status === 403);

  const DESCRIPTION_TEXT =
    "Learn the fundamentals of free-range poultry farming in this test module.";
  const descriptionPatch = await api(`/api/seminars/modules/${moduleId}`, {
    method: "PATCH",
    token: owner,
    body: { description: DESCRIPTION_TEXT },
  });
  record(
    "PATCH module description -> 200 persisted",
    descriptionPatch.status === 200 &&
      descriptionPatch.body?.data?.description === DESCRIPTION_TEXT
  );

  const published = await api(`/api/seminars/modules/${moduleId}`, {
    method: "PATCH",
    token: owner,
    body: { isPublished: true },
  });
  record(
    "Publish fixture module -> 200",
    published.status === 200 && published.body?.data?.isPublished === true
  );

  const farmerCatalog = await api("/api/seminars/modules", { token: farmer });
  const farmerModule = (farmerCatalog.body?.data ?? []).find(
    (entry: { id?: string }) => entry.id === moduleId
  );
  record(
    "Farmer list payload carries coverImageUrl + description",
    farmerModule?.coverImageUrl === secondCoverUrl &&
      farmerModule?.description === DESCRIPTION_TEXT
  );

  const pendingUpload = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: owner,
    formData: imageForm(fakePng(), "cover3.png", "image/png"),
  });
  record(
    "Cover change on a published module marks unpublished changes",
    pendingUpload.status === 200 &&
      pendingUpload.body?.data?.hasUnpublishedChanges === true &&
      pendingUpload.body?.data?.isPublished === true
  );
  const thirdCoverUrl: string | undefined =
    pendingUpload.body?.data?.coverImageUrl;

  const farmerRemove = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "DELETE",
    token: farmer,
  });
  record("Farmer cannot remove a cover -> 403", farmerRemove.status === 403);

  const coverRemoved = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "DELETE",
    token: owner,
  });
  record(
    "Remove cover -> 200 with null coverImageUrl",
    coverRemoved.status === 200 &&
      coverRemoved.body?.data?.coverImageUrl === null
  );
  const thirdCoverPath = thirdCoverUrl ? storedFilePath(thirdCoverUrl) : "";
  record(
    "Removed cover file deleted from disk",
    thirdCoverPath !== "" && !existsSync(thirdCoverPath)
  );

  const removedAgain = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "DELETE",
    token: owner,
  });
  record("Removing a missing cover -> 409", removedAgain.status === 409);

  const clearedDescription = await api(`/api/seminars/modules/${moduleId}`, {
    method: "PATCH",
    token: owner,
    body: { description: "" },
  });
  record(
    "Empty description clears to null",
    clearedDescription.status === 200 &&
      clearedDescription.body?.data?.description === null
  );

  /* Leave a cover in place so the module hard-delete below must also
     clean up the stored cover file. */
  const finalCover = await api(`/api/seminars/modules/${moduleId}/cover-image`, {
    method: "PUT",
    token: owner,
    formData: imageForm(fakePng(), "final.png", "image/png"),
  });
  const finalCoverUrl: string | undefined = finalCover.body?.data?.coverImageUrl;
  const finalCoverPath = finalCoverUrl ? storedFilePath(finalCoverUrl) : "";

  // ---- Hard delete removes the stored file ---------------------------------
  const deleted = await api(
    `/api/seminars/modules/${moduleId}/videos/${uploadedVideo.id}`,
    { method: "DELETE", token: owner }
  );
  record(
    "Hard-delete uploaded video -> 200 DELETED",
    deleted.status === 200 && deleted.body?.data?.result === "DELETED"
  );
  record(
    "Stored file removed from disk after delete",
    storedPath !== "" && !existsSync(storedPath)
  );

  // ---- Staff progress overview --------------------------------------------
  const progress = await api("/api/seminars/progress", { token: owner });
  record(
    "GET /api/seminars/progress (owner) -> 200 with enrollments",
    progress.status === 200 &&
      Array.isArray(progress.body?.data) &&
      progress.body.data.every(
        (entry: { seminarEnrollments?: unknown[] }) =>
          Array.isArray(entry.seminarEnrollments)
      ),
    `customers=${progress.body?.count}`
  );
  const farmerProgress = await api("/api/seminars/progress", { token: farmer });
  record(
    "GET /api/seminars/progress (farmer) -> 403",
    farmerProgress.status === 403
  );

  // ---- Cleanup -------------------------------------------------------------
  const moduleDelete = await api(`/api/seminars/modules/${moduleId}`, {
    method: "DELETE",
    token: owner,
  });
  record(
    "Fixture module hard-deleted",
    moduleDelete.status === 200 && moduleDelete.body?.data?.result === "DELETED"
  );
  record(
    "Module hard-delete removed the stored cover file",
    finalCoverPath !== "" && !existsSync(finalCoverPath),
    finalCoverPath
  );

  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` — ${failed.length} FAILED` : ""
    }\n`
  );
  process.exitCode = failed.length ? 1 : 0;

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await cleanupFixture().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
