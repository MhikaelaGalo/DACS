/**
 * DACS delete-endpoint E2E test (2026-08-20 delete-button milestone).
 *
 * Run with the dev server already started (npm run dev), then:
 *   npx tsx scripts/test-deletes.ts
 *
 * Covers the delete/archive contracts end to end against the real
 * database: seminar module delete-vs-archive, video delete-vs-archive
 * (with completion recalculation), question soft delete, form
 * delete-vs-archive on the new forms module, plus the documented
 * "delete = DISABLED" user behavior and the historical-file delete
 * contract's failure modes (its happy path lives in test-backend.ts).
 *
 * Hermetic: uses seminar module numbers 95/96 and "Delete-Test" forms,
 * cleans them at start and end, and restores the test user's role.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const FIXTURE_MODULE_NUMBERS = [95, 96];
const FIXTURE_FORM_PREFIX = "Delete-Test";

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function finish(): void {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  console.log(`\n========================================`);
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`========================================\n`);
  if (failed > 0) process.exitCode = 1;
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON response
  }

  return { status: response.status, body };
}

async function getWebApiKey(projectId: string): Promise<string | null> {
  try {
    const credential = applicationDefault();
    const accessToken = await credential.getAccessToken();
    const headers = { Authorization: `Bearer ${accessToken.access_token}` };

    const appsResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`,
      { headers }
    );
    const appsBody = (await appsResponse.json()) as {
      apps?: Array<{ name: string }>;
    };

    const firstApp = appsBody.apps?.[0];
    if (!firstApp) return null;

    const configResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/${firstApp.name}/config`,
      { headers }
    );
    const configBody = (await configResponse.json()) as { apiKey?: string };
    return configBody.apiKey ?? null;
  } catch {
    return process.env.FIREBASE_WEB_API_KEY ?? null;
  }
}

async function cleanupFixtures(): Promise<void> {
  await prisma.quizAttempt.deleteMany({
    where: {
      enrollment: { module: { moduleNumber: { in: FIXTURE_MODULE_NUMBERS } } },
    },
  });
  await prisma.seminarProgress.deleteMany({
    where: {
      enrollment: { module: { moduleNumber: { in: FIXTURE_MODULE_NUMBERS } } },
    },
  });
  await prisma.seminarEnrollment.deleteMany({
    where: { module: { moduleNumber: { in: FIXTURE_MODULE_NUMBERS } } },
  });
  await prisma.seminarModule.deleteMany({
    where: { moduleNumber: { in: FIXTURE_MODULE_NUMBERS } },
  });
  await prisma.formSubmission.deleteMany({
    where: { form: { name: { startsWith: FIXTURE_FORM_PREFIX } } },
  });
  await prisma.form.deleteMany({
    where: { name: { startsWith: FIXTURE_FORM_PREFIX } },
  });
}

async function setRole(
  userId: string,
  role: "OWNER_EXECUTIVE" | "ADMINISTRATIVE_STAFF" | "CLIENT_FARMER" | "IT_STAFF"
) {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

async function main(): Promise<void> {
  console.log(`\nDACS delete-endpoint test against ${BASE_URL}\n`);
  await assertTestServer();

  // ---- 0. Health + token --------------------------------------------------
  const health = await api("/api/health");
  record("GET /api/health", health.status === 200 && health.body?.success === true);
  if (health.status !== 200) return finish();

  if (!firebaseAuth) {
    record("Firebase Admin initialized", false, "service-account JSON missing");
    return finish();
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8")) as {
    project_id: string;
  };
  const apiKey = await getWebApiKey(serviceAccount.project_id);
  if (!apiKey) {
    record("Fetch web API key", false, "set FIREBASE_WEB_API_KEY manually");
    return finish();
  }

  /* Pin the suite to the dedicated SYNTHETIC farmer fixture (real
     accounts hold staff roles now; lemonyfroggo is the dev Owner). */
  let testUser;
  try {
    testUser = await firebaseAuth.getUserByEmail(
      "dacs.farmer.fixture@dacs-test.example"
    );
  } catch {
    testUser = await firebaseAuth.createUser({
      email: "dacs.farmer.fixture@dacs-test.example",
      emailVerified: true,
      displayName: "DACS Backend Test User",
    });
  }
  if (!testUser.emailVerified) {
    await firebaseAuth.updateUser(testUser.uid, { emailVerified: true });
  }

  const customToken = await firebaseAuth.createCustomToken(testUser.uid);
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const token = ((await signInResponse.json()) as { idToken?: string }).idToken;
  record("Mint Firebase ID token", Boolean(token), testUser.email ?? "");
  if (!token) return finish();

  const dacsUser = await prisma.user.findUnique({
    where: { firebaseUid: testUser.uid },
  });
  if (!dacsUser) {
    record("Find DACS user row", false, "no synced user for the Firebase UID");
    return finish();
  }
  const originalRole = dacsUser.role;

  const profile = await prisma.customerProfile.findFirst({
    where: { userId: dacsUser.id, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
  if (!profile) {
    record("Find customer profile for history fixtures", false);
    return finish();
  }

  await cleanupFixtures();
  await setRole(dacsUser.id, "OWNER_EXECUTIVE");
  record("Test user acting as OWNER_EXECUTIVE", true, dacsUser.email);

  try {
    // ---- A. Seminar module delete vs archive ------------------------------
    const createA = await api("/api/seminars/modules", {
      method: "POST",
      token,
      body: { moduleNumber: 96, title: "Delete Probe A", passingScore: 70 },
    });
    record("A: create fixture module 96 -> 201", createA.status === 201);
    const moduleAId: string = createA.body?.data?.id;

    await api(`/api/seminars/modules/${moduleAId}/videos`, {
      method: "POST",
      token,
      body: {
        title: "Probe video",
        videoUrl: "https://example.com/a.mp4",
        displayOrder: 1,
      },
    });
    await api(`/api/seminars/modules/${moduleAId}/questions`, {
      method: "POST",
      token,
      body: {
        questionText: "Probe question?",
        choices: [
          { choiceText: "Yes", isCorrect: true, displayOrder: 1 },
          { choiceText: "No", isCorrect: false, displayOrder: 2 },
        ],
      },
    });

    const hardDelete = await api(`/api/seminars/modules/${moduleAId}`, {
      method: "DELETE",
      token,
    });
    record(
      "A: DELETE module without enrollments -> 200 DELETED",
      hardDelete.status === 200 && hardDelete.body?.data?.result === "DELETED",
      hardDelete.body?.message ?? `status ${hardDelete.status}`
    );

    const goneModule = await prisma.seminarModule.findUnique({
      where: { id: moduleAId },
    });
    const orphanVideos = await prisma.seminarVideo.count({
      where: { moduleId: moduleAId },
    });
    const orphanQuestions = await prisma.seminarQuestion.count({
      where: { moduleId: moduleAId },
    });
    record(
      "A: module row gone, videos/questions cascaded (no orphans)",
      goneModule === null && orphanVideos === 0 && orphanQuestions === 0,
      `videos=${orphanVideos} questions=${orphanQuestions}`
    );

    const deleteLog = await prisma.activityLog.findFirst({
      where: { action: "SEMINAR_MODULE_DELETED", recordId: moduleAId },
    });
    record("A: SEMINAR_MODULE_DELETED activity logged", deleteLog !== null);

    // Archive path: same module number, now with an enrollment.
    const createA2 = await api("/api/seminars/modules", {
      method: "POST",
      token,
      body: { moduleNumber: 96, title: "Delete Probe A2", passingScore: 70 },
    });
    const moduleA2Id: string = createA2.body?.data?.id;
    await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    await prisma.seminarEnrollment.create({
      data: { customerProfileId: profile.id, moduleId: moduleA2Id },
    });

    const archiveDelete = await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "DELETE",
      token,
    });
    record(
      "A: DELETE module WITH enrollment -> 200 ARCHIVED",
      archiveDelete.status === 200 &&
        archiveDelete.body?.data?.result === "ARCHIVED",
      archiveDelete.body?.message ?? `status ${archiveDelete.status}`
    );

    const archivedRow = await prisma.seminarModule.findUnique({
      where: { id: moduleA2Id },
    });
    const enrollmentIntact = await prisma.seminarEnrollment.count({
      where: { moduleId: moduleA2Id },
    });
    record(
      "A: archived row kept (archivedAt set, unpublished), enrollment intact",
      archivedRow !== null &&
        archivedRow.archivedAt !== null &&
        archivedRow.isPublished === false &&
        enrollmentIntact === 1
    );

    const archiveLog = await prisma.activityLog.findFirst({
      where: { action: "SEMINAR_MODULE_ARCHIVED", recordId: moduleA2Id },
    });
    record("A: SEMINAR_MODULE_ARCHIVED activity logged", archiveLog !== null);

    const repeatDelete = await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "DELETE",
      token,
    });
    record(
      "A: repeated DELETE on archived module -> 409",
      repeatDelete.status === 409,
      repeatDelete.body?.message ?? `status ${repeatDelete.status}`
    );

    const republish = await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    record(
      "A: publishing an archived module -> 409",
      republish.status === 409,
      republish.body?.message ?? `status ${republish.status}`
    );

    const staffList = await api("/api/seminars/modules", { token });
    const staffSees = (staffList.body?.data ?? []).find(
      (entry: any) => entry.id === moduleA2Id
    );
    record(
      "A: staff listing still shows archived module with archivedAt",
      Boolean(staffSees) && staffSees.archivedAt !== null
    );

    const badUuid = await api("/api/seminars/modules/not-a-uuid", {
      method: "DELETE",
      token,
    });
    record("A: invalid module ID -> 400", badUuid.status === 400);

    const missing = await api(
      "/api/seminars/modules/00000000-0000-4000-8000-000000000000",
      { method: "DELETE", token }
    );
    record("A: nonexistent module -> 404", missing.status === 404);

    const noAuth = await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "DELETE",
    });
    record("A: DELETE without token -> 401", noAuth.status === 401);

    // ---- B. Seminar video delete vs archive -------------------------------
    const createB = await api("/api/seminars/modules", {
      method: "POST",
      token,
      body: { moduleNumber: 95, title: "Delete Probe B", passingScore: 50 },
    });
    const moduleBId: string = createB.body?.data?.id;
    await api(`/api/seminars/modules/${moduleBId}`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });

    const videoIds: string[] = [];
    for (const [index, title] of ["V1", "V2", "V3"].entries()) {
      const created = await api(`/api/seminars/modules/${moduleBId}/videos`, {
        method: "POST",
        token,
        body: {
          title,
          videoUrl: `https://example.com/${title}.mp4`,
          displayOrder: index + 1,
        },
      });
      videoIds.push(created.body?.data?.id);
    }
    record("B: fixture module 95 with 3 videos", videoIds.every(Boolean));

    const hardVideo = await api(
      `/api/seminars/modules/${moduleBId}/videos/${videoIds[1]}`,
      { method: "DELETE", token }
    );
    const v2Gone = await prisma.seminarVideo.findUnique({
      where: { id: videoIds[1] },
    });
    record(
      "B: DELETE video without watch history -> 200 DELETED, row gone",
      hardVideo.status === 200 &&
        hardVideo.body?.data?.result === "DELETED" &&
        v2Gone === null
    );

    const crossModule = await api(
      `/api/seminars/modules/${moduleA2Id}/videos/${videoIds[0]}`,
      { method: "DELETE", token }
    );
    const v1Still = await prisma.seminarVideo.findUnique({
      where: { id: videoIds[0] },
    });
    record(
      "B: DELETE another module's video through ID mixing -> 404, video kept",
      crossModule.status === 404 && v1Still !== null
    );

    const missingVideo = await api(
      `/api/seminars/modules/${moduleBId}/videos/00000000-0000-4000-8000-000000000000`,
      { method: "DELETE", token }
    );
    record("B: nonexistent video -> 404", missingVideo.status === 404);

    const badVideoUuid = await api(
      `/api/seminars/modules/${moduleBId}/videos/abc`,
      { method: "DELETE", token }
    );
    record("B: invalid video ID -> 400", badVideoUuid.status === 400);

    // History fixtures: farmer watched V1 fully and passed the quiz,
    // but V3 is still unwatched — the enrollment is NOT complete.
    const enrollmentB = await prisma.seminarEnrollment.create({
      data: { customerProfileId: profile.id, moduleId: moduleBId },
    });
    await prisma.seminarProgress.create({
      data: {
        enrollmentId: enrollmentB.id,
        videoId: videoIds[0],
        progressPercent: 100,
        completedAt: new Date(),
      },
    });
    await prisma.quizAttempt.create({
      data: {
        enrollmentId: enrollmentB.id,
        score: 1,
        totalScore: 1,
        percentage: 100,
        passed: true,
        answers: [],
      },
    });

    const beforeRecalc = await prisma.seminarEnrollment.findUnique({
      where: { id: enrollmentB.id },
      select: { completedAt: true },
    });
    record(
      "B: enrollment incomplete while V3 is unwatched",
      beforeRecalc?.completedAt === null
    );

    // Deleting unwatched V3 leaves V1 as the only active video — the
    // farmer has now "watched everything", so recalculation completes
    // the enrollment inside the same delete transaction.
    const deleteV3 = await api(
      `/api/seminars/modules/${moduleBId}/videos/${videoIds[2]}`,
      { method: "DELETE", token }
    );
    const afterRecalc = await prisma.seminarEnrollment.findUnique({
      where: { id: enrollmentB.id },
      select: { completedAt: true },
    });
    record(
      "B: deleting the unwatched video completes the enrollment (recalc)",
      deleteV3.status === 200 && afterRecalc?.completedAt !== null
    );

    const archiveVideo = await api(
      `/api/seminars/modules/${moduleBId}/videos/${videoIds[0]}`,
      { method: "DELETE", token }
    );
    const v1Row = await prisma.seminarVideo.findUnique({
      where: { id: videoIds[0] },
    });
    const v1Progress = await prisma.seminarProgress.count({
      where: { videoId: videoIds[0] },
    });
    record(
      "B: DELETE watched video -> 200 ARCHIVED, progress history intact",
      archiveVideo.status === 200 &&
        archiveVideo.body?.data?.result === "ARCHIVED" &&
        v1Row?.archivedAt !== null &&
        v1Progress === 1
    );

    const repeatVideo = await api(
      `/api/seminars/modules/${moduleBId}/videos/${videoIds[0]}`,
      { method: "DELETE", token }
    );
    record("B: repeated DELETE on archived video -> 409", repeatVideo.status === 409);

    const moduleBRow = await prisma.seminarModule.findUnique({
      where: { id: moduleBId },
      select: { hasUnpublishedChanges: true },
    });
    record(
      "B: video removal flags published module hasUnpublishedChanges",
      moduleBRow?.hasUnpublishedChanges === true
    );

    const videoLogs = await prisma.activityLog.findMany({
      where: {
        action: { in: ["SEMINAR_VIDEO_DELETED", "SEMINAR_VIDEO_ARCHIVED"] },
        recordId: { in: [videoIds[0], videoIds[1], videoIds[2]] },
      },
    });
    record(
      "B: SEMINAR_VIDEO_DELETED/ARCHIVED activity logged",
      videoLogs.length === 3,
      `${videoLogs.length} log rows`
    );

    const staffListB = await api("/api/seminars/modules", { token });
    const staffModuleB = (staffListB.body?.data ?? []).find(
      (entry: any) => entry.id === moduleBId
    );
    record(
      "B: archived video excluded from module payload",
      Boolean(staffModuleB) && staffModuleB.videos.length === 0,
      `videos=${staffModuleB?.videos?.length}`
    );

    // ---- C. Seminar question soft delete ----------------------------------
    const questionIds: string[] = [];
    for (const text of ["Q1?", "Q2?"]) {
      const created = await api(`/api/seminars/modules/${moduleBId}/questions`, {
        method: "POST",
        token,
        body: {
          questionText: text,
          choices: [
            { choiceText: "Yes", isCorrect: true, displayOrder: 1 },
            { choiceText: "No", isCorrect: false, displayOrder: 2 },
          ],
        },
      });
      questionIds.push(created.body?.data?.id);
    }

    const softDelete = await api(
      `/api/seminars/modules/${moduleBId}/questions/${questionIds[1]}`,
      { method: "DELETE", token }
    );
    const q2Row = await prisma.seminarQuestion.findUnique({
      where: { id: questionIds[1] },
      include: { choices: true },
    });
    record(
      "C: DELETE question -> 200 SOFT_DELETED (row + choices kept, isActive false)",
      softDelete.status === 200 &&
        softDelete.body?.data?.result === "SOFT_DELETED" &&
        q2Row !== null &&
        q2Row.isActive === false &&
        q2Row.choices.length === 2
    );

    const repeatQuestion = await api(
      `/api/seminars/modules/${moduleBId}/questions/${questionIds[1]}`,
      { method: "DELETE", token }
    );
    record(
      "C: repeated DELETE -> 200 ALREADY_INACTIVE (idempotent)",
      repeatQuestion.status === 200 &&
        repeatQuestion.body?.data?.result === "ALREADY_INACTIVE"
    );

    const staffListC = await api("/api/seminars/modules", { token });
    const staffModuleC = (staffListC.body?.data ?? []).find(
      (entry: any) => entry.id === moduleBId
    );
    record(
      "C: inactive question excluded from active question count",
      staffModuleC?._count?.questions === 1,
      `active questions=${staffModuleC?._count?.questions}`
    );

    const crossQuestion = await api(
      `/api/seminars/modules/${moduleA2Id}/questions/${questionIds[0]}`,
      { method: "DELETE", token }
    );
    record("C: another module's question -> 404", crossQuestion.status === 404);

    const questionLog = await prisma.activityLog.findFirst({
      where: { action: "SEMINAR_QUESTION_DELETED", recordId: questionIds[1] },
    });
    record("C: SEMINAR_QUESTION_DELETED activity logged", questionLog !== null);

    // ---- E. Forms module --------------------------------------------------
    const formCreate = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Order Intake`,
        description: "Delete-milestone fixture form",
        fields: [
          { type: "title", label: "Order Intake" },
          {
            type: "short-answer",
            label: "Farm name",
            required: true,
            placeholder: "Enter your farm name",
          },
          {
            type: "dropdown",
            label: "Preferred breed",
            options: ["Dominant Brown", "Dominant Black"],
            allowOther: true,
          },
          { type: "time", label: "Pickup time", timeFormat: "12-hour" },
        ],
      },
    });
    const formId: string = formCreate.body?.data?.id;
    record(
      "E: POST /api/forms -> 201 with 4 ordered fields",
      formCreate.status === 201 &&
        formCreate.body?.data?.fields?.length === 4 &&
        formCreate.body.data.fields[0].displayOrder === 1,
      formCreate.body?.message ?? `status ${formCreate.status}`
    );

    const badType = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Bad`,
        fields: [{ type: "hologram", label: "x" }],
      },
    });
    record("E: unknown field type -> 400", badType.status === 400);

    const badOptions = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Bad`,
        fields: [{ type: "short-answer", label: "x", options: ["a"] }],
      },
    });
    record("E: options on a non-option field -> 400", badOptions.status === 400);

    const badTime = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Bad`,
        fields: [{ type: "dropdown", label: "x", timeFormat: "12-hour" }],
      },
    });
    record("E: timeFormat on a non-time field -> 400", badTime.status === 400);

    const noName = await api("/api/forms", {
      method: "POST",
      token,
      body: { fields: [] },
    });
    record("E: missing form name -> 400", noName.status === 400);

    const unexpected = await api("/api/forms", {
      method: "POST",
      token,
      body: { name: `${FIXTURE_FORM_PREFIX} Bad`, sneaky: true },
    });
    record("E: unexpected body field -> 400", unexpected.status === 400);

    const tooMany = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Bad`,
        fields: Array.from({ length: 101 }, () => ({
          type: "short-answer",
          label: "x",
        })),
      },
    });
    record("E: more than 100 fields -> 400", tooMany.status === 400);

    const formPatch = await api(`/api/forms/${formId}`, {
      method: "PATCH",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Order Intake v2`,
        fields: [
          { type: "title", label: "Order Intake v2" },
          { type: "number", label: "Head count", required: true },
        ],
      },
    });
    const fieldRows = await prisma.formField.count({ where: { formId } });
    record(
      "E: PATCH replaces the whole field definition",
      formPatch.status === 200 && fieldRows === 2,
      `field rows=${fieldRows}`
    );

    const publish = await api(`/api/forms/${formId}/publish`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    const publishAgain = await api(`/api/forms/${formId}/publish`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    record(
      "E: publish -> 200, same-state publish -> 409",
      publish.status === 200 && publishAgain.status === 409
    );

    const formHardDelete = await api(`/api/forms/${formId}`, {
      method: "DELETE",
      token,
    });
    const formGone = await prisma.form.findUnique({ where: { id: formId } });
    const fieldsGone = await prisma.formField.count({ where: { formId } });
    record(
      "E: DELETE form without submissions -> 200 DELETED, fields cascaded",
      formHardDelete.status === 200 &&
        formHardDelete.body?.data?.result === "DELETED" &&
        formGone === null &&
        fieldsGone === 0
    );

    // Archive path: a form with a submission.
    const formCreate2 = await api("/api/forms", {
      method: "POST",
      token,
      body: {
        name: `${FIXTURE_FORM_PREFIX} Submitted Form`,
        fields: [{ type: "short-answer", label: "Anything" }],
      },
    });
    const form2Id: string = formCreate2.body?.data?.id;
    await prisma.formSubmission.create({
      data: {
        formId: form2Id,
        customerProfileId: profile.id,
        answers: { anything: "customer data that must survive" },
      },
    });

    const formArchive = await api(`/api/forms/${form2Id}`, {
      method: "DELETE",
      token,
    });
    const form2Row = await prisma.form.findUnique({ where: { id: form2Id } });
    const submissionIntact = await prisma.formSubmission.count({
      where: { formId: form2Id },
    });
    record(
      "E: DELETE form WITH submission -> 200 ARCHIVED, submission intact",
      formArchive.status === 200 &&
        formArchive.body?.data?.result === "ARCHIVED" &&
        form2Row?.archivedAt !== null &&
        form2Row?.isPublished === false &&
        submissionIntact === 1
    );

    const formRepeat = await api(`/api/forms/${form2Id}`, {
      method: "DELETE",
      token,
    });
    record("E: repeated DELETE on archived form -> 409", formRepeat.status === 409);

    const editArchived = await api(`/api/forms/${form2Id}`, {
      method: "PATCH",
      token,
      body: { name: "Should not work" },
    });
    const publishArchived = await api(`/api/forms/${form2Id}/publish`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    record(
      "E: editing/publishing an archived form -> 409",
      editArchived.status === 409 && publishArchived.status === 409
    );

    const defaultList = await api("/api/forms", { token });
    const archivedList = await api("/api/forms?includeArchived=true", { token });
    const hiddenByDefault = !(defaultList.body?.data ?? []).some(
      (entry: any) => entry.id === form2Id
    );
    const visibleWhenAsked = (archivedList.body?.data ?? []).some(
      (entry: any) => entry.id === form2Id && entry.archivedAt !== null
    );
    record(
      "E: archived form hidden by default, listed with ?includeArchived=true",
      hiddenByDefault && visibleWhenAsked
    );

    const formBadUuid = await api("/api/forms/nope", { method: "DELETE", token });
    const formMissing = await api(
      "/api/forms/00000000-0000-4000-8000-000000000000",
      { method: "DELETE", token }
    );
    const formNoAuth = await api(`/api/forms/${form2Id}`, { method: "DELETE" });
    record(
      "E: invalid ID -> 400, nonexistent -> 404, no token -> 401",
      formBadUuid.status === 400 &&
        formMissing.status === 404 &&
        formNoAuth.status === 401,
      `${formBadUuid.status}/${formMissing.status}/${formNoAuth.status}`
    );

    const formActions = await prisma.activityLog.findMany({
      where: {
        module: "FORMS",
        action: {
          in: [
            "FORM_CREATED",
            "FORM_UPDATED",
            "FORM_PUBLISHED",
            "FORM_DELETED",
            "FORM_ARCHIVED",
          ],
        },
      },
      select: { action: true },
    });
    const seenActions = new Set(formActions.map((entry) => entry.action));
    record(
      "E: FORM_* activity actions all logged",
      ["FORM_CREATED", "FORM_UPDATED", "FORM_PUBLISHED", "FORM_DELETED", "FORM_ARCHIVED"].every(
        (action) => seenActions.has(action)
      ),
      [...seenActions].join(", ")
    );

    // ---- D. Users: documented delete behavior -----------------------------
    const selfDisable = await api(`/api/users/${dacsUser.id}/status`, {
      method: "PATCH",
      token,
      body: { status: "DISABLED" },
    });
    record(
      "D: DISABLED is the user-delete behavior; self-disable stays blocked -> 403",
      selfDisable.status === 403,
      selfDisable.body?.message ?? `status ${selfDisable.status}`
    );

    // ---- G. Historical delete contract (happy path in test-backend.ts) ----
    const histBadUuid = await api("/api/historical/files/nope", {
      method: "DELETE",
      token,
    });
    const histMissing = await api(
      "/api/historical/files/00000000-0000-4000-8000-000000000000",
      { method: "DELETE", token }
    );
    const histNoAuth = await api(
      "/api/historical/files/00000000-0000-4000-8000-000000000000",
      { method: "DELETE" }
    );
    record(
      "G: historical delete contract — invalid 400, missing 404, no token 401",
      histBadUuid.status === 400 &&
        histMissing.status === 404 &&
        histNoAuth.status === 401,
      `${histBadUuid.status}/${histMissing.status}/${histNoAuth.status}`
    );

    // ---- RBAC: everything above requires staff ----------------------------
    await setRole(dacsUser.id, "CLIENT_FARMER");

    const farmerModuleDelete = await api(`/api/seminars/modules/${moduleA2Id}`, {
      method: "DELETE",
      token,
    });
    const farmerVideoDelete = await api(
      `/api/seminars/modules/${moduleBId}/videos/${videoIds[0]}`,
      { method: "DELETE", token }
    );
    const farmerQuestionDelete = await api(
      `/api/seminars/modules/${moduleBId}/questions/${questionIds[0]}`,
      { method: "DELETE", token }
    );
    const farmerFormsList = await api("/api/forms", { token });
    const farmerFormDelete = await api(`/api/forms/${form2Id}`, {
      method: "DELETE",
      token,
    });
    const farmerHistDelete = await api(
      "/api/historical/files/00000000-0000-4000-8000-000000000000",
      { method: "DELETE", token }
    );
    record(
      "RBAC: farmer blocked from every delete route -> 403",
      [
        farmerModuleDelete,
        farmerVideoDelete,
        farmerQuestionDelete,
        farmerFormsList,
        farmerFormDelete,
        farmerHistDelete,
      ].every((response) => response.status === 403),
      [
        farmerModuleDelete.status,
        farmerVideoDelete.status,
        farmerQuestionDelete.status,
        farmerFormsList.status,
        farmerFormDelete.status,
        farmerHistDelete.status,
      ].join("/")
    );

    const farmerList = await api("/api/seminars/modules", { token });
    const farmerData = farmerList.body?.data ?? [];
    const farmerSeesArchived = farmerData.some(
      (entry: any) => entry.id === moduleA2Id
    );
    const farmerModuleB = farmerData.find((entry: any) => entry.id === moduleBId);
    record(
      "RBAC: farmer list hides archived module, hides archived videos",
      !farmerSeesArchived &&
        Boolean(farmerModuleB) &&
        farmerModuleB.videos.length === 0,
      `sees archived=${farmerSeesArchived} moduleB videos=${farmerModuleB?.videos?.length}`
    );

    const farmerQuiz = await api(`/api/seminars/modules/${moduleBId}/quiz`, {
      token,
    });
    record(
      "RBAC: farmer quiz serves only the active question",
      farmerQuiz.status === 200 && farmerQuiz.body?.data?.questions?.length === 1,
      `questions=${farmerQuiz.body?.data?.questions?.length}`
    );
  } finally {
    // ---- Cleanup ----------------------------------------------------------
    await setRole(dacsUser.id, originalRole);
    await cleanupFixtures();
    record("Fixtures cleaned up, role restored", true, originalRole);
  }

  return finish();
}

main()
  .catch((error) => {
    console.error("Delete-endpoint test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
