/**
 * DACS automatic certificate verification (generation + 2-year validity
 * + ownership + expiry):
 *
 *   - Completing Modules 1-3 generates the Certificate of Attendance
 *     with its SEM number, its issue date AND its validity window
 *     (validUntil = issue date + exactly 2 years) in one step. No staff
 *     upload, replace or issue action exists or is required.
 *   - GET /api/seminars/progress (staff) carries issuedAt + validUntil
 *     immediately, so the admin table reads a real Validity Date and a
 *     derived Valid status with nothing for staff to enter.
 *   - The retired staff endpoints (PUT .../file, POST .../issue) are
 *     gone; a generated certificate has no stored file, and clients
 *     render it from the record itself.
 *   - GET /api/seminars/certificates/me/:id/file still serves files
 *     left by the retired manual workflow, ONLY to their owner (foreign
 *     IDs read as 404); expired certificates stay listed, downloadable
 *     and undeleted as history.
 *
 * Prerequisites: test server on the .env.test port, staff seeded.
 * Run: npx tsx scripts/test-certificate-issuance.ts
 */
import { assertTestServer } from "./lib/test-env";

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";
import {
  deletePrivateFile,
  PRIVATE_UPLOADS_ROOT,
  savePrivateFile,
} from "../src/services/fileStorage.service";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const PROJECT_ID = "dacs-8f430";
const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";
const OTHER_FARMER_EMAIL = "dacs.certificate.other@dacs-test.example";
const CERTIFICATE_FILES_DIR = path.join(PRIVATE_UPLOADS_ROOT, "dacs-certificates");

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

/* Raw fetch for the binary download endpoints. */
async function apiRaw(
  pathName: string,
  token?: string
): Promise<{ status: number; bytes: Buffer; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${pathName}`, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, bytes, headers: response.headers };
}

async function getWebApiKey(): Promise<string> {
  if (process.env.FIREBASE_WEB_API_KEY) return process.env.FIREBASE_WEB_API_KEY;
  const { applicationDefault } = await import("firebase-admin/app");
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
  if (!body.idToken) throw new Error(`Could not mint ID token for ${uid}.`);
  return body.idToken;
}

async function ensureFirebaseUser(email: string) {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch {
    return firebaseAuth.createUser({ email, emailVerified: true });
  }
}

async function ensureProfile(token: string, firstName: string, lastName: string) {
  const existing = await api("/api/customers/me", { token });
  if (existing.status === 200) return existing.body?.data;
  const created = await api("/api/customers/me", {
    method: "POST",
    token,
    body: {
      firstName,
      lastName,
      occupation: "Poultry Farmer",
      addressLine1: "Certificate Suite Street",
      cityMunicipality: "Sample City",
      province: "Sample Province",
    },
  });
  if (created.status !== 201) {
    throw new Error(
      `Could not create profile for ${firstName}: ${created.status} ${created.body?.message ?? ""}`
    );
  }
  return created.body?.data;
}

async function setRole(
  userId: string,
  role: "CLIENT_FARMER" | "ADMINISTRATIVE_STAFF"
): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

/* Smallest valid-by-magic-bytes fixtures. */
function fakePdf(marker: string): Buffer {
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n% DACS certificate suite ${marker}\n`, "ascii"),
    Buffer.alloc(128, 0x20),
    Buffer.from("\n%%EOF\n", "ascii"),
  ]);
}

function fakeJpeg(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(96, 0x33),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function certificateForm(bytes: Buffer, type: string, name: string): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  return form;
}

/* Files currently stored for one request (validates replace cleanup). */
function storedFilesFor(requestId: string): string[] {
  if (!existsSync(CERTIFICATE_FILES_DIR)) return [];
  return readdirSync(CERTIFICATE_FILES_DIR).filter((file) =>
    file.startsWith(requestId)
  );
}

/*
 * Get-or-create published Modules 1-3, each with at least one active
 * video and one active question. Fixture assembly only — module content
 * management itself is covered by the other suites.
 */
async function ensureRequiredModule(moduleNumber: number) {
  let module = await prisma.seminarModule.findUnique({
    where: { moduleNumber },
  });
  if (!module) {
    module = await prisma.seminarModule.create({
      data: {
        moduleNumber,
        title: `Certificate Suite Module ${moduleNumber}`,
        passingScore: 50,
        isPublished: true,
      },
    });
  } else if (module.archivedAt || !module.isPublished) {
    module = await prisma.seminarModule.update({
      where: { id: module.id },
      data: { archivedAt: null, isPublished: true },
    });
  }

  const video = await prisma.seminarVideo.findFirst({
    where: { moduleId: module.id, archivedAt: null },
  });
  if (!video) {
    await prisma.seminarVideo.create({
      data: {
        moduleId: module.id,
        title: `Module ${moduleNumber} Lecture`,
        videoUrl: `https://videos.dacs.example/cert-suite-${moduleNumber}.mp4`,
        displayOrder: 1,
      },
    });
  }

  const question = await prisma.seminarQuestion.findFirst({
    where: {
      moduleId: module.id,
      isActive: true,
      choices: { some: { isCorrect: true } },
    },
  });
  if (!question) {
    await prisma.seminarQuestion.create({
      data: {
        moduleId: module.id,
        questionText: `Module ${moduleNumber}: ready to proceed?`,
        points: 1,
        displayOrder: 99,
        choices: {
          create: [
            { choiceText: "Yes", isCorrect: true, displayOrder: 1 },
            { choiceText: "No", isCorrect: false, displayOrder: 2 },
          ],
        },
      },
    });
  }

  return module;
}

/* Complete one module through the real farmer API path. */
async function completeModule(token: string, moduleId: string): Promise<boolean> {
  const started = await api(`/api/seminars/modules/${moduleId}/start`, {
    method: "POST",
    token,
  });
  if (started.status >= 400) return false;

  const videos = await prisma.seminarVideo.findMany({
    where: { moduleId, archivedAt: null },
    select: { id: true },
  });
  for (const video of videos) {
    const progressed = await api(`/api/seminars/videos/${video.id}/progress`, {
      method: "PATCH",
      token,
      body: { progressPercent: 100 },
    });
    if (progressed.status >= 400) return false;
  }

  const questions = await prisma.seminarQuestion.findMany({
    where: { moduleId, isActive: true },
    select: { id: true, choices: { select: { id: true, isCorrect: true } } },
  });
  const answers = questions.map((question) => ({
    questionId: question.id,
    choiceId:
      question.choices.find((choice) => choice.isCorrect)?.id ??
      question.choices[0]?.id,
  }));
  const submitted = await api(`/api/seminars/modules/${moduleId}/quiz`, {
    method: "POST",
    token,
    body: { answers },
  });
  return submitted.status < 400 && submitted.body?.data?.passed === true;
}

function finish(): void {
  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`
  );
  if (failed.length) {
    console.log("Failed checks:");
    for (const failure of failed) {
      console.log(`  - ${failure.name}${failure.detail ? ` (${failure.detail})` : ""}`);
    }
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log(`\nIssued-certificate workflow verification against ${BASE_URL}\n`);
  await assertTestServer();
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");

  const health = await api("/api/health");
  record("GET /api/health", health.status === 200 && health.body?.success === true);
  if (health.status !== 200) return finish();

  const apiKey = await getWebApiKey();

  // ---- Accounts -----------------------------------------------------------
  const farmerFirebase = await ensureFirebaseUser(FARMER_EMAIL);
  const otherFirebase = await ensureFirebaseUser(OTHER_FARMER_EMAIL);
  const farmerToken = await mintIdToken(apiKey, farmerFirebase.uid);
  const otherToken = await mintIdToken(apiKey, otherFirebase.uid);
  await api("/api/auth/sync", { method: "POST", token: farmerToken });
  await api("/api/auth/sync", { method: "POST", token: otherToken });

  const farmerUser = await prisma.user.findUnique({
    where: { firebaseUid: farmerFirebase.uid },
  });
  const otherUser = await prisma.user.findUnique({
    where: { firebaseUid: otherFirebase.uid },
  });
  if (!farmerUser || !otherUser) {
    record("Sync DACS user rows", false, "auth sync did not create users");
    return finish();
  }
  /* A previous run may have left the fixture parked as staff. */
  await setRole(farmerUser.id, "CLIENT_FARMER");
  await setRole(otherUser.id, "CLIENT_FARMER");

  await ensureProfile(farmerToken, "Certificate", "Fixture");
  await ensureProfile(otherToken, "Other", "Farmer");
  const farmerProfile = await prisma.customerProfile.findFirst({
    where: { userId: farmerUser.id, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
  const otherProfile = await prisma.customerProfile.findFirst({
    where: { userId: otherUser.id, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
  if (!farmerProfile || !otherProfile) {
    record("Customer profiles ready", false);
    return finish();
  }
  record("Fixture accounts ready", true, farmerProfile.customerNumber);

  // ---- Reset fixture state ------------------------------------------------
  await prisma.certificateRequest.deleteMany({
    where: {
      customerProfileId: { in: [farmerProfile.id, otherProfile.id] },
    },
  });
  await prisma.seminarEnrollment.deleteMany({
    where: {
      customerProfileId: { in: [farmerProfile.id, otherProfile.id] },
      module: { moduleNumber: { in: [1, 2, 3] } },
    },
  });

  const modules = [] as Array<{ id: string; moduleNumber: number }>;
  for (const moduleNumber of [1, 2, 3]) {
    modules.push(await ensureRequiredModule(moduleNumber));
  }
  record("Modules 1-3 published with content", modules.length === 3);

  // ---- 1-2. Completion drives eligibility ---------------------------------
  const completedOneTwo =
    (await completeModule(farmerToken, modules[0].id)) &&
    (await completeModule(farmerToken, modules[1].id));
  record("Farmer completes Modules 1-2 via API", completedOneTwo);

  const partialCertificates = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  record(
    "No certificate before Modules 1-3 all complete",
    partialCertificates.status === 200 &&
      (partialCertificates.body?.data ?? []).length === 0,
    `count=${partialCertificates.body?.count}`
  );

  /*
   * Module completion is NOT seminar completion. With Modules 1-2 done
   * the account has two completed modules and no certificate at all —
   * the progress payload has to say exactly that, because it is what the
   * customer site reads to decide whether a certificate may be offered.
   */
  const partialProgress = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const partialCycle = partialProgress.body?.data?.seminarCompletion;
  const partialModules = partialProgress.body?.data?.modules ?? [];
  const moduleRow = (n: number) =>
    partialModules.find((entry: any) => entry.moduleNumber === n);
  record(
    "Modules 1-2 done: modules report completed, the SEMINAR does not",
    partialProgress.status === 200 &&
      moduleRow(1)?.completed === true &&
      moduleRow(2)?.completed === true &&
      moduleRow(3)?.completed === false &&
      partialCycle?.completedRequiredModules === 2 &&
      partialCycle?.allRequiredCompleted === false &&
      partialCycle?.certificate === null &&
      partialCycle?.completionValidUntil === null &&
      partialCycle?.completionValidityStatus === "NONE",
    `completed=${partialCycle?.completedRequiredModules} all=${partialCycle?.allRequiredCompleted} cert=${partialCycle?.certificate}`
  );
  record(
    "Intermediate completion never locks the exams",
    moduleRow(1)?.retakeLocked === false &&
      moduleRow(2)?.retakeLocked === false &&
      partialCycle?.retakeLocked === false
  );

  const completedThree = await completeModule(farmerToken, modules[2].id);
  record("Farmer completes Module 3 via API", completedThree);

  const afterCompletion = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  const autoCertificate = (afterCompletion.body?.data ?? [])[0];
  record(
    "Completing the trio generates a VALID certificate (SEM number, no file)",
    afterCompletion.status === 200 &&
      autoCertificate?.status === "APPROVED" &&
      /^SEM-\d{4}-\d{6}$/.test(autoCertificate?.certificateNumber ?? "") &&
      autoCertificate?.issuedAt !== null &&
      autoCertificate?.validUntil !== null &&
      autoCertificate?.validityStatus === "VALID" &&
      autoCertificate?.hasCertificateFile === false,
    autoCertificate?.certificateNumber ?? "missing"
  );
  const requestId: string = autoCertificate?.id;
  if (!requestId) return finish();

  record(
    "Farmer payload never contains the stored file path",
    !JSON.stringify(afterCompletion.body).includes("certificateFilePath") &&
      !JSON.stringify(afterCompletion.body).includes("dacs-certificates/")
  );

  /* ---- Completed seminar: recognized, and the exams close ---------------
   *
   * The finished seminar is a record on the account, not something the
   * farmer re-proves. /me/progress carries the whole cycle (all three
   * modules, the certificate that earned, the 2-year window) and the
   * required modules' exams refuse to reopen while that window stands.
   */
  const cycleProgress = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const cycle = cycleProgress.body?.data?.seminarCompletion;
  const cycleApprovedAt = Date.parse(autoCertificate?.certificateIssuedAt ?? "");
  const expectedCycleValidUntil = new Date(cycleApprovedAt);
  expectedCycleValidUntil.setFullYear(expectedCycleValidUntil.getFullYear() + 2);
  record(
    "Completion + certificate + 2-year window come from /me/progress",
    cycleProgress.status === 200 &&
      cycle?.allRequiredCompleted === true &&
      cycle?.completedRequiredModules === 3 &&
      cycle?.certificate?.id === requestId &&
      cycle?.certificate?.certificateNumber ===
        autoCertificate?.certificateNumber &&
      cycle?.completionValidityStatus === "VALID" &&
      cycle?.retakeLocked === true &&
      Date.parse(cycle?.completionValidUntil ?? "") ===
        expectedCycleValidUntil.getTime(),
    `validUntil=${cycle?.completionValidUntil} locked=${cycle?.retakeLocked}`
  );

  const cycleModules = cycleProgress.body?.data?.modules ?? [];
  record(
    "Every required module reports completed + retakeLocked",
    [1, 2, 3].every((moduleNumber) => {
      const row = cycleModules.find(
        (entry: any) => entry.moduleNumber === moduleNumber
      );
      return row?.completed === true && row?.retakeLocked === true;
    }),
    cycleModules
      .map((entry: any) => `${entry.moduleNumber}:${entry.retakeLocked}`)
      .join(" ")
  );

  const module3Questions = await prisma.seminarQuestion.findMany({
    where: { moduleId: modules[2].id, isActive: true },
    select: { id: true, choices: { select: { id: true, isCorrect: true } } },
  });
  const module3Answers = module3Questions.map((question) => ({
    questionId: question.id,
    choiceId:
      question.choices.find((choice) => choice.isCorrect)?.id ??
      question.choices[0]?.id,
  }));

  const retakeRead = await api(`/api/seminars/modules/${modules[2].id}/quiz`, {
    token: farmerToken,
  });
  const retakeSubmit = await api(`/api/seminars/modules/${modules[2].id}/quiz`, {
    method: "POST",
    token: farmerToken,
    body: { answers: module3Answers },
  });
  record(
    "Completed seminar: Module 3 exam refuses both read and submit -> 409",
    retakeRead.status === 409 && retakeSubmit.status === 409,
    retakeRead.body?.message ?? `${retakeRead.status}/${retakeSubmit.status}`
  );

  const attemptsAfterRetake = await prisma.quizAttempt.count({
    where: { enrollment: { customerProfileId: farmerProfile.id } },
  });
  record(
    "Refused retake recorded no attempt and kept the completion intact",
    attemptsAfterRetake === 3 &&
      (await prisma.seminarEnrollment.count({
        where: { customerProfileId: farmerProfile.id, completedAt: { not: null } },
      })) === 3,
    `attempts=${attemptsAfterRetake}`
  );

  /* A brand-new session sees the same finished seminar — no local state,
     no exam attempt needed to rediscover it. */
  const freshToken = await mintIdToken(apiKey, farmerFirebase.uid);
  const freshCycle = await api("/api/seminars/me/progress", {
    token: freshToken,
  });
  record(
    "Fresh sign-in still reports the completed seminar + its certificate",
    freshCycle.body?.data?.seminarCompletion?.retakeLocked === true &&
      freshCycle.body?.data?.seminarCompletion?.certificate?.id === requestId
  );

  /* After the 2-year window the lock lifts by itself — and the earned
     certificate and completion history are still there. */
  const realCertificate = await prisma.certificateRequest.findUnique({
    where: { id: requestId },
    select: { certificateIssuedAt: true, issuedAt: true, validUntil: true },
  });
  const longAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 731);
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: {
      certificateIssuedAt: longAgo,
      issuedAt: longAgo,
      validUntil: new Date(Date.now() - 1000 * 60 * 60 * 24),
    },
  });
  const expiredCycle = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const reopenedQuiz = await api(`/api/seminars/modules/${modules[2].id}/quiz`, {
    token: farmerToken,
  });
  record(
    "After 2 years the exams reopen and the history is preserved",
    expiredCycle.body?.data?.seminarCompletion?.retakeLocked === false &&
      expiredCycle.body?.data?.seminarCompletion?.completionValidityStatus ===
        "EXPIRED" &&
      expiredCycle.body?.data?.seminarCompletion?.allRequiredCompleted ===
        true &&
      expiredCycle.body?.data?.seminarCompletion?.certificate?.id ===
        requestId &&
      reopenedQuiz.status === 200,
    `locked=${expiredCycle.body?.data?.seminarCompletion?.retakeLocked} quiz=${reopenedQuiz.status}`
  );
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: {
      certificateIssuedAt: realCertificate?.certificateIssuedAt,
      issuedAt: realCertificate?.issuedAt,
      validUntil: realCertificate?.validUntil,
    },
  });

  // ---- Automatic issuance: the record carries its own validity ------------
  await setRole(farmerUser.id, "ADMINISTRATIVE_STAFF");

  const stored = await prisma.certificateRequest.findUnique({
    where: { id: requestId },
    select: {
      certificateIssuedAt: true,
      issuedAt: true,
      issuedByUserId: true,
      validUntil: true,
      certificateFilePath: true,
    },
  });
  const autoIssuedAt = stored?.issuedAt ?? null;
  const autoValidUntil = stored?.validUntil ?? null;
  const expectedAutoValidUntil = autoIssuedAt
    ? new Date(autoIssuedAt.getTime())
    : null;
  expectedAutoValidUntil?.setFullYear(expectedAutoValidUntil.getFullYear() + 2);
  record(
    "Generation stamps issuedAt = certificateIssuedAt, no staff actor",
    autoIssuedAt !== null &&
      stored?.certificateIssuedAt?.getTime() === autoIssuedAt.getTime() &&
      stored?.issuedByUserId === null,
    `issuedAt=${autoIssuedAt?.toISOString()} by=${stored?.issuedByUserId}`
  );
  record(
    "Generation stamps validUntil = issue date + exactly 2 years",
    autoValidUntil !== null &&
      expectedAutoValidUntil !== null &&
      autoValidUntil.getTime() === expectedAutoValidUntil.getTime(),
    `validUntil=${autoValidUntil?.toISOString()}`
  );
  record(
    "The generated certificate carries no file — clients render the record",
    stored?.certificateFilePath === null,
    stored?.certificateFilePath ?? "null"
  );

  // ---- The admin table reads it with no staff action ----------------------
  const overview = await api("/api/seminars/progress", { token: farmerToken });
  const overviewRow = (overview.body?.data ?? []).find(
    (row: any) => row.id === farmerProfile.id
  );
  const overviewCert = overviewRow?.certificateRequests?.[0];
  record(
    "Admin overview: Validity Date + Valid status straight after Module 3",
    overview.status === 200 &&
      overviewRow?.seminarEnrollments?.every(
        (enrollment: any) => enrollment.completedAt !== null
      ) &&
      overviewCert?.id === requestId &&
      Date.parse(overviewCert?.issuedAt ?? "") === autoIssuedAt?.getTime() &&
      Date.parse(overviewCert?.validUntil ?? "") === autoValidUntil?.getTime(),
    `issuedAt=${overviewCert?.issuedAt} validUntil=${overviewCert?.validUntil}`
  );

  // ---- The manual workflow is gone ----------------------------------------
  const goneUpload = await api(`/api/seminars/certificates/${requestId}/file`, {
    method: "PUT",
    token: farmerToken,
    formData: certificateForm(fakePdf("v1"), "application/pdf", "manual.pdf"),
  });
  const goneIssue = await api(`/api/seminars/certificates/${requestId}/issue`, {
    method: "POST",
    token: farmerToken,
  });
  record(
    "Staff upload/replace and issue endpoints no longer exist -> 404",
    goneUpload.status === 404 && goneIssue.status === 404,
    `upload=${goneUpload.status} issue=${goneIssue.status}`
  );
  record(
    "No staff action ever wrote a certificate file",
    storedFilesFor(requestId).length === 0,
    `stored=${storedFilesFor(requestId).length}`
  );

  // ---- Farmer view of the generated certificate ---------------------------
  await setRole(farmerUser.id, "CLIENT_FARMER");
  const farmerList = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  const farmerCert = (farmerList.body?.data ?? [])[0];
  record(
    "Certificate is VALID in the farmer account with no staff step",
    farmerList.status === 200 &&
      farmerCert?.id === requestId &&
      Date.parse(farmerCert?.issuedAt ?? "") === autoIssuedAt?.getTime() &&
      Date.parse(farmerCert?.validUntil ?? "") === autoValidUntil?.getTime() &&
      farmerCert?.validityStatus === "VALID" &&
      farmerCert?.hasCertificateFile === false,
    farmerCert?.validityStatus ?? "missing"
  );

  const noFileDownload = await apiRaw(
    `/api/seminars/certificates/me/${requestId}/file`,
    farmerToken
  );
  record(
    "A generated certificate has no stored file to stream -> 404",
    noFileDownload.status === 404
  );

  /*
   * Records left by the retired manual workflow keep their file and stay
   * downloadable — the endpoints below exist for exactly that history.
   */
  const legacyBytes = fakeJpeg();
  const legacyPath = await savePrivateFile(
    "dacs-certificates",
    `${requestId}-legacy.jpg`,
    legacyBytes
  );
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: {
      certificateFilePath: legacyPath,
      certificateFileName: "legacy-scan.jpg",
      certificateFileMimeType: "image/jpeg",
      certificateFileSize: legacyBytes.length,
      fileUploadedAt: new Date(),
    },
  });

  const legacyDownload = await apiRaw(
    `/api/seminars/certificates/me/${requestId}/file?download=1`,
    farmerToken
  );
  record(
    "Farmer downloads a legacy stored file",
    legacyDownload.status === 200 &&
      legacyDownload.bytes.equals(legacyBytes) &&
      (legacyDownload.headers.get("content-disposition") ?? "").includes(
        "attachment"
      ) &&
      (legacyDownload.headers.get("content-type") ?? "").includes("image/jpeg"),
    legacyDownload.headers.get("content-disposition") ?? ""
  );

  await setRole(farmerUser.id, "ADMINISTRATIVE_STAFF");
  const staffDownload = await apiRaw(
    `/api/seminars/certificates/${requestId}/file`,
    farmerToken
  );
  record(
    "Staff View/Download reads the same legacy file",
    staffDownload.status === 200 && staffDownload.bytes.equals(legacyBytes)
  );
  await setRole(farmerUser.id, "CLIENT_FARMER");

  // ---- Ownership enforcement ----------------------------------------------
  const foreignDownload = await apiRaw(
    `/api/seminars/certificates/me/${requestId}/file`,
    otherToken
  );
  record(
    "Another customer cannot download the certificate -> 404",
    foreignDownload.status === 404
  );

  const otherList = await api("/api/seminars/certificates/me", {
    token: otherToken,
  });
  record(
    "Another customer list does not contain the certificate",
    otherList.status === 200 &&
      !(otherList.body?.data ?? []).some((row: any) => row.id === requestId),
    `count=${otherList.body?.count}`
  );

  const anonymousDownload = await apiRaw(
    `/api/seminars/certificates/me/${requestId}/file`
  );
  record("Unauthenticated download -> 401", anonymousDownload.status === 401);

  // ---- Persistence ---------------------------------------------------------
  const refetch = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  record(
    "Re-fetch (fresh session) still returns the same issued certificate",
    Date.parse((refetch.body?.data ?? [])[0]?.issuedAt ?? "") ===
      autoIssuedAt?.getTime()
  );

  // ---- Expiry is automatic and history is kept ----------------------------
  const expiredIssuedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 731);
  const expiredValidUntil = new Date(Date.now() - 1000 * 60 * 60 * 24);
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: { issuedAt: expiredIssuedAt, validUntil: expiredValidUntil },
  });

  const expiredList = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  record(
    "Certificate reports EXPIRED automatically after validUntil",
    (expiredList.body?.data ?? [])[0]?.validityStatus === "EXPIRED",
    (expiredList.body?.data ?? [])[0]?.validityStatus ?? "missing"
  );

  const expiredDownload = await apiRaw(
    `/api/seminars/certificates/me/${requestId}/file`,
    farmerToken
  );
  record(
    "Expired certificate stays listed and downloadable (history)",
    expiredDownload.status === 200 && expiredDownload.bytes.equals(legacyBytes)
  );

  const stillThere = await prisma.certificateRequest.findUnique({
    where: { id: requestId },
    select: { certificateNumber: true, certificateFilePath: true },
  });
  record(
    "Expiry never deletes the certificate record or its file",
    stillThere?.certificateNumber === autoCertificate?.certificateNumber &&
      stillThere?.certificateFilePath === legacyPath,
    stillThere?.certificateNumber ?? "missing"
  );

  /* Boundary: valid strictly before validUntil, expired on/after it. */
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: { validUntil: new Date(Date.now() + 1000 * 60 * 5) },
  });
  const boundaryValid = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: { validUntil: new Date(Date.now() - 1000) },
  });
  const boundaryExpired = await api("/api/seminars/certificates/me", {
    token: farmerToken,
  });
  record(
    "Validity boundary: before validUntil VALID, after it EXPIRED",
    (boundaryValid.body?.data ?? [])[0]?.validityStatus === "VALID" &&
      (boundaryExpired.body?.data ?? [])[0]?.validityStatus === "EXPIRED"
  );

  /* Leave the fixture in its real generated state. */
  await prisma.certificateRequest.update({
    where: { id: requestId },
    data: {
      issuedAt: autoIssuedAt,
      validUntil: autoValidUntil,
      certificateFilePath: null,
      certificateFileName: null,
      certificateFileMimeType: null,
      certificateFileSize: null,
      fileUploadedAt: null,
    },
  });
  await deletePrivateFile(legacyPath);
  record(
    "Suite cleaned up its legacy-file fixture",
    storedFilesFor(requestId).length === 0
  );

  // ---- Audit trail ---------------------------------------------------------
  const autoIssueLog = await prisma.activityLog.findFirst({
    where: { recordId: requestId, action: "CERTIFICATE_AUTO_ISSUED" },
    select: { action: true },
  });
  record("Activity log captured the automatic issuance", autoIssueLog !== null);

  const issueNotification = await prisma.notification.findFirst({
    where: {
      userId: farmerUser.id,
      recordId: requestId,
      title: "Seminar certificate issued",
    },
  });
  record(
    "Farmer notified when the certificate was generated",
    Boolean(issueNotification)
  );

  // ---- Restore -------------------------------------------------------------
  await setRole(farmerUser.id, "CLIENT_FARMER");
  record("Fixture farmer role restored", true);

  finish();
}

main()
  .catch((error) => {
    console.error("\nSuite crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
