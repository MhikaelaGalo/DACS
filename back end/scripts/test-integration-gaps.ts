/**
 * DACS integration-gap E2E test (2026-08-22 milestone).
 *
 * Run with the dev server already started (npm run dev), then:
 *   npx tsx scripts/test-integration-gaps.ts
 *
 * Covers the endpoints built to unblock admin-frontend integration:
 *   - seminar question/video editing, video reordering, certificate
 *     template upload (with publish-state bookkeeping)
 *   - staff order editing (server-side totals) and order cancellation
 *   - staff customer/farm correction endpoints
 *   - the audit-log read API (filters, pagination, RBAC)
 *   - dashboard visual persistence (CRUD + reorder + cap)
 *   - the role-permission matrix API (defaults, overrides, guards)
 *
 * Hermetic: uses seminar module number 97, GAP-TEST-* products,
 * GAP-ARCH-* customer fixtures, and "GAP Test Farm"; cleans them at
 * start and end, restores the test user's role and profile fields.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const FIXTURE_MODULE_NUMBER = 97;
const FIXTURE_PRODUCT_PREFIX = "GAP-TEST-";
const FIXTURE_CUSTOMER_PREFIX = "GAP-ARCH-";
const FIXTURE_FARM_NAME = "GAP Test Farm";

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
  pathName: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${pathName}`, {
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

async function apiUpload(
  pathName: string,
  token: string,
  fieldName: string,
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append(
    fieldName,
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename
  );

  const response = await fetch(`${BASE_URL}${pathName}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON response
  }

  return { status: response.status, body };
}

/* A tiny buffer that passes the PNG magic-byte check. */
function pngBuffer(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
  ]);
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

async function cleanupFixtures(testUserId: string | null): Promise<void> {
  await prisma.seminarModule.deleteMany({
    where: { moduleNumber: FIXTURE_MODULE_NUMBER },
  });

  await prisma.order.deleteMany({
    where: {
      items: {
        some: {
          product: { productCode: { startsWith: FIXTURE_PRODUCT_PREFIX } },
        },
      },
    },
  });
  await prisma.product.deleteMany({
    where: { productCode: { startsWith: FIXTURE_PRODUCT_PREFIX } },
  });

  await prisma.farm.deleteMany({ where: { farmName: FIXTURE_FARM_NAME } });
  await prisma.customerProfile.deleteMany({
    where: { customerNumber: { startsWith: FIXTURE_CUSTOMER_PREFIX } },
  });

  await prisma.rolePermission.deleteMany({
    where: {
      role: "IT_STAFF",
      permissionModule: { in: ["Forms", "Historical Data"] },
    },
  });

  if (testUserId) {
    await prisma.dashboardVisual.deleteMany({ where: { userId: testUserId } });
  }
}

async function setRole(
  userId: string,
  role: "OWNER_EXECUTIVE" | "ADMINISTRATIVE_STAFF" | "CLIENT_FARMER" | "IT_STAFF"
) {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

async function main(): Promise<void> {
  console.log(`\nDACS integration-gap test against ${BASE_URL}\n`);
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

  /* Pin the suite to the dedicated test account, like the other suites. */
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
    select: { id: true, customerNumber: true, occupation: true },
  });
  if (!profile) {
    record("Find customer profile for fixtures", false);
    return finish();
  }
  const originalOccupation = profile.occupation;

  await cleanupFixtures(dacsUser.id);
  await setRole(dacsUser.id, "OWNER_EXECUTIVE");
  record("Test user acting as OWNER_EXECUTIVE", true, dacsUser.email);

  let certificateTemplateUrl: string | null = null;

  try {
    // ---- A. Seminar content editing ---------------------------------------
    const createModule = await api("/api/seminars/modules", {
      method: "POST",
      token,
      body: {
        moduleNumber: FIXTURE_MODULE_NUMBER,
        title: "Gap Probe Module",
        passingScore: 70,
      },
    });
    record("A: create fixture module 97 -> 201", createModule.status === 201);
    const moduleId: string = createModule.body?.data?.id;

    const videoA = await api(`/api/seminars/modules/${moduleId}/videos`, {
      method: "POST",
      token,
      body: { title: "Video A", videoUrl: "https://example.com/a.mp4", displayOrder: 1 },
    });
    const videoB = await api(`/api/seminars/modules/${moduleId}/videos`, {
      method: "POST",
      token,
      body: { title: "Video B", videoUrl: "https://example.com/b.mp4", displayOrder: 2 },
    });
    const videoAId: string = videoA.body?.data?.id;
    const videoBId: string = videoB.body?.data?.id;

    const createQuestion = await api(
      `/api/seminars/modules/${moduleId}/questions`,
      {
        method: "POST",
        token,
        body: {
          questionText: "Original question?",
          choices: [
            { choiceText: "One", isCorrect: true, displayOrder: 1 },
            { choiceText: "Two", isCorrect: false, displayOrder: 2 },
            { choiceText: "Three", isCorrect: false, displayOrder: 3 },
          ],
        },
      }
    );
    const questionId: string = createQuestion.body?.data?.id;
    const originalChoices: Array<{ id: string; choiceText: string }> =
      createQuestion.body?.data?.choices ?? [];
    record(
      "A: fixture videos + question created",
      Boolean(videoAId && videoBId && questionId) && originalChoices.length === 3
    );

    // Edit the question: keep two choices by id (flip the correct one),
    // drop the third, add a brand-new choice.
    const keptFirst = originalChoices[0];
    const keptSecond = originalChoices[1];
    const droppedThird = originalChoices[2];

    const editQuestion = await api(
      `/api/seminars/modules/${moduleId}/questions/${questionId}`,
      {
        method: "PATCH",
        token,
        body: {
          questionText: "Edited question?",
          choices: [
            { id: keptFirst.id, choiceText: "One edited", isCorrect: false },
            { id: keptSecond.id, choiceText: "Two edited", isCorrect: true },
            { choiceText: "Brand new", isCorrect: false },
          ],
        },
      }
    );
    const editedChoices: Array<{
      id: string;
      choiceText: string;
      isCorrect: boolean;
    }> = editQuestion.body?.data?.choices ?? [];
    record(
      "A: edit question -> 200, id preserved, text updated",
      editQuestion.status === 200 &&
        editQuestion.body?.data?.id === questionId &&
        editQuestion.body?.data?.questionText === "Edited question?",
      `status=${editQuestion.status}`
    );
    record(
      "A: choice ids preserved, dropped choice removed, new one added",
      editedChoices.length === 3 &&
        editedChoices.some(
          (choice) => choice.id === keptFirst.id && choice.choiceText === "One edited"
        ) &&
        editedChoices.every((choice) => choice.id !== droppedThird.id) &&
        editedChoices.find((choice) => choice.isCorrect)?.id === keptSecond.id,
      `choices=${editedChoices.length}`
    );

    const twoCorrect = await api(
      `/api/seminars/modules/${moduleId}/questions/${questionId}`,
      {
        method: "PATCH",
        token,
        body: {
          choices: [
            { choiceText: "X", isCorrect: true },
            { choiceText: "Y", isCorrect: true },
          ],
        },
      }
    );
    record(
      "A: edit with two correct choices -> 400",
      twoCorrect.status === 400,
      `status=${twoCorrect.status}`
    );

    const foreignChoice = await api(
      `/api/seminars/modules/${moduleId}/questions/${questionId}`,
      {
        method: "PATCH",
        token,
        body: {
          choices: [
            {
              id: "00000000-0000-0000-0000-000000000000",
              choiceText: "X",
              isCorrect: true,
            },
            { choiceText: "Y", isCorrect: false },
          ],
        },
      }
    );
    record(
      "A: edit with a foreign choice id -> 400",
      foreignChoice.status === 400,
      `status=${foreignChoice.status}`
    );

    const missingQuestion = await api(
      `/api/seminars/modules/${moduleId}/questions/00000000-0000-0000-0000-000000000000`,
      { method: "PATCH", token, body: { questionText: "X?" } }
    );
    record(
      "A: edit unknown question id -> 404",
      missingQuestion.status === 404,
      `status=${missingQuestion.status}`
    );

    const editVideo = await api(
      `/api/seminars/modules/${moduleId}/videos/${videoAId}`,
      {
        method: "PATCH",
        token,
        body: { title: "Video A renamed", videoUrl: "https://example.com/a2.mp4" },
      }
    );
    record(
      "A: edit video -> 200, fields updated",
      editVideo.status === 200 &&
        editVideo.body?.data?.title === "Video A renamed" &&
        editVideo.body?.data?.videoUrl === "https://example.com/a2.mp4",
      `status=${editVideo.status}`
    );

    const videoOrderRejected = await api(
      `/api/seminars/modules/${moduleId}/videos/${videoAId}`,
      { method: "PATCH", token, body: { displayOrder: 5 } }
    );
    record(
      "A: video edit rejects displayOrder (reorder endpoint owns it)",
      videoOrderRejected.status === 400,
      `status=${videoOrderRejected.status}`
    );

    const reorder = await api(
      `/api/seminars/modules/${moduleId}/videos/reorder`,
      {
        method: "PATCH",
        token,
        body: { orderedVideoIds: [videoBId, videoAId] },
      }
    );
    const reordered: Array<{ id: string; displayOrder: number }> =
      reorder.body?.data ?? [];
    record(
      "A: reorder videos -> 200, positions follow the list",
      reorder.status === 200 &&
        reordered.find((video) => video.id === videoBId)?.displayOrder === 1 &&
        reordered.find((video) => video.id === videoAId)?.displayOrder === 2,
      `status=${reorder.status}`
    );

    const reorderDuplicate = await api(
      `/api/seminars/modules/${moduleId}/videos/reorder`,
      { method: "PATCH", token, body: { orderedVideoIds: [videoAId, videoAId] } }
    );
    record(
      "A: reorder with duplicate ids -> 400",
      reorderDuplicate.status === 400,
      `status=${reorderDuplicate.status}`
    );

    const reorderIncomplete = await api(
      `/api/seminars/modules/${moduleId}/videos/reorder`,
      { method: "PATCH", token, body: { orderedVideoIds: [videoAId] } }
    );
    record(
      "A: reorder missing a video -> 400",
      reorderIncomplete.status === 400,
      `status=${reorderIncomplete.status}`
    );

    const reorderForeign = await api(
      `/api/seminars/modules/${moduleId}/videos/reorder`,
      {
        method: "PATCH",
        token,
        body: {
          orderedVideoIds: [videoAId, "00000000-0000-0000-0000-000000000000"],
        },
      }
    );
    record(
      "A: reorder with a foreign video id -> 400",
      reorderForeign.status === 400,
      `status=${reorderForeign.status}`
    );

    // Publish, then edit content: the pending-changes flag must appear.
    await api(`/api/seminars/modules/${moduleId}`, {
      method: "PATCH",
      token,
      body: { isPublished: true },
    });
    await api(`/api/seminars/modules/${moduleId}/videos/${videoAId}`, {
      method: "PATCH",
      token,
      body: { title: "Video A published edit" },
    });
    const moduleList = await api("/api/seminars/modules", { token });
    const listedModule = (moduleList.body?.data ?? []).find(
      (entry: any) => entry.id === moduleId
    );
    record(
      "A: editing a published module sets hasUnpublishedChanges",
      listedModule?.hasUnpublishedChanges === true,
      `flag=${listedModule?.hasUnpublishedChanges}`
    );

    // ---- B. Certificate template ------------------------------------------
    const uploadTemplate = await apiUpload(
      `/api/seminars/modules/${moduleId}/certificate-template`,
      token,
      "image",
      pngBuffer(),
      "template.png",
      "image/png"
    );
    certificateTemplateUrl =
      uploadTemplate.body?.data?.certificateTemplateUrl ?? null;
    record(
      "B: upload certificate template -> 200 with stored URL",
      uploadTemplate.status === 200 &&
        typeof certificateTemplateUrl === "string" &&
        certificateTemplateUrl.includes("/uploads/certificate-templates/"),
      `status=${uploadTemplate.status}`
    );

    const badTemplate = await apiUpload(
      `/api/seminars/modules/${moduleId}/certificate-template`,
      token,
      "image",
      Buffer.from("not an image at all"),
      "template.txt",
      "text/plain"
    );
    record(
      "B: non-image certificate template -> 400",
      badTemplate.status === 400,
      `status=${badTemplate.status}`
    );

    // ---- C. Staff customer + farm editing ---------------------------------
    const staffCustomerEdit = await api(`/api/customers/${profile.id}`, {
      method: "PATCH",
      token,
      body: { occupation: "Gap Test Occupation" },
    });
    record(
      "C: staff customer edit -> 200, field updated",
      staffCustomerEdit.status === 200 &&
        staffCustomerEdit.body?.data?.occupation === "Gap Test Occupation",
      `status=${staffCustomerEdit.status}`
    );

    const protectedAttempt = await api(`/api/customers/${profile.id}`, {
      method: "PATCH",
      token,
      body: { customerNumber: "DAPG-99999", occupation: "x" },
    });
    record(
      "C: staff edit of protected field -> 400 + protectedFields",
      protectedAttempt.status === 400 &&
        Array.isArray(protectedAttempt.body?.protectedFields) &&
        protectedAttempt.body.protectedFields.includes("customerNumber"),
      `status=${protectedAttempt.status}`
    );

    const archivedProfile = await prisma.customerProfile.create({
      data: {
        customerNumber: `${FIXTURE_CUSTOMER_PREFIX}77778`,
        firstName: "Archived",
        lastName: "Fixture",
        archivedAt: new Date(),
      },
    });
    const archivedEdit = await api(`/api/customers/${archivedProfile.id}`, {
      method: "PATCH",
      token,
      body: { occupation: "x" },
    });
    record(
      "C: staff edit of archived customer -> 404",
      archivedEdit.status === 404,
      `status=${archivedEdit.status}`
    );

    const fixtureFarm = await prisma.farm.create({
      data: {
        customerProfileId: profile.id,
        farmName: FIXTURE_FARM_NAME,
        isPrimary: false,
      },
    });
    const staffFarmEdit = await api(
      `/api/customers/${profile.id}/farms/${fixtureFarm.id}`,
      { method: "PATCH", token, body: { province: "Gap Province" } }
    );
    record(
      "C: staff farm edit -> 200, field updated",
      staffFarmEdit.status === 200 &&
        staffFarmEdit.body?.data?.province === "Gap Province",
      `status=${staffFarmEdit.status}`
    );

    const wrongCustomerFarm = await api(
      `/api/customers/${archivedProfile.id}/farms/${fixtureFarm.id}`,
      { method: "PATCH", token, body: { province: "X" } }
    );
    record(
      "C: farm edit under the wrong customer -> 404",
      wrongCustomerFarm.status === 404,
      `status=${wrongCustomerFarm.status}`
    );

    // ---- D. Orders: fixtures as farmer ------------------------------------
    const vetProduct = await prisma.product.create({
      data: {
        productCode: `${FIXTURE_PRODUCT_PREFIX}VET`,
        name: "Gap Test Dewormer",
        category: "VETERINARY_PRODUCT",
        unitPrice: 100,
      },
    });
    const psProduct = await prisma.product.create({
      data: {
        productCode: `${FIXTURE_PRODUCT_PREFIX}PS`,
        name: "Gap Test Parent Stock",
        category: "PARENT_STOCK",
        unitPrice: 1000,
      },
    });

    await setRole(dacsUser.id, "CLIENT_FARMER");

    async function submitVetOrder() {
      return api("/api/orders", {
        method: "POST",
        token,
        body: {
          orderType: "VETERINARY_PRODUCT",
          items: [{ productId: vetProduct.id, quantity: 2 }],
        },
      });
    }

    const orderA = await submitVetOrder();
    const orderB = await submitVetOrder();
    const orderC = await submitVetOrder();
    const orderAId: string = orderA.body?.data?.id;
    const orderBId: string = orderB.body?.data?.id;
    const orderCId: string = orderC.body?.data?.id;
    record(
      "D: farmer submitted three fixture orders",
      orderA.status === 201 && orderB.status === 201 && orderC.status === 201,
      `statuses=${orderA.status},${orderB.status},${orderC.status}`
    );

    const farmerEditAttempt = await api(`/api/orders/${orderAId}`, {
      method: "PATCH",
      token,
      body: { instructions: "farmer edit" },
    });
    record(
      "D: farmer cannot use the staff order-edit endpoint -> 403",
      farmerEditAttempt.status === 403,
      `status=${farmerEditAttempt.status}`
    );

    const farmerCancelAttempt = await api(`/api/orders/${orderAId}/status`, {
      method: "PATCH",
      token,
      body: { status: "CANCELLED" },
    });
    record(
      "D: farmer cannot cancel through the status endpoint -> 403",
      farmerCancelAttempt.status === 403,
      `status=${farmerCancelAttempt.status}`
    );

    // ---- E. Orders: staff editing -----------------------------------------
    await setRole(dacsUser.id, "OWNER_EXECUTIVE");

    const orderEdit = await api(`/api/orders/${orderAId}`, {
      method: "PATCH",
      token,
      body: {
        items: [{ productId: vetProduct.id, quantity: 5, unitPrice: 999.5 }],
        feeTotal: 250,
        receiverName: "Gap Receiver",
        instructions: "Handle with care",
      },
    });
    const editedItems: Array<{ unitPriceSnapshot: string; lineTotal: string }> =
      orderEdit.body?.data?.items ?? [];
    record(
      "E: staff order edit -> 200, totals recalculated server-side",
      orderEdit.status === 200 &&
        Number(orderEdit.body?.data?.subtotal) === 4997.5 &&
        Number(orderEdit.body?.data?.feeTotal) === 250 &&
        Number(orderEdit.body?.data?.totalAmount) === 5247.5 &&
        editedItems.length === 1 &&
        Number(editedItems[0]?.unitPriceSnapshot) === 999.5,
      `total=${orderEdit.body?.data?.totalAmount}`
    );

    const secondEdit = await api(`/api/orders/${orderAId}`, {
      method: "PATCH",
      token,
      body: { items: [{ productId: vetProduct.id, quantity: 4 }] },
    });
    record(
      "E: re-edit without unitPrice keeps the quoted snapshot",
      secondEdit.status === 200 &&
        Number(secondEdit.body?.data?.items?.[0]?.unitPriceSnapshot) === 999.5 &&
        Number(secondEdit.body?.data?.totalAmount) === 999.5 * 4 + 250,
      `total=${secondEdit.body?.data?.totalAmount}`
    );

    const totalInjection = await api(`/api/orders/${orderAId}`, {
      method: "PATCH",
      token,
      body: { totalAmount: 1 },
    });
    record(
      "E: client-supplied totalAmount -> 400",
      totalInjection.status === 400,
      `status=${totalInjection.status}`
    );

    const wrongCategory = await api(`/api/orders/${orderAId}`, {
      method: "PATCH",
      token,
      body: { items: [{ productId: psProduct.id, quantity: 1 }] },
    });
    record(
      "E: item of the wrong category -> 400",
      wrongCategory.status === 400,
      `status=${wrongCategory.status}`
    );

    await prisma.order.update({
      where: { id: orderBId },
      data: { status: "DELIVERED" },
    });
    const deliveredEdit = await api(`/api/orders/${orderBId}`, {
      method: "PATCH",
      token,
      body: { instructions: "too late" },
    });
    record(
      "E: editing a DELIVERED order -> 409",
      deliveredEdit.status === 409,
      `status=${deliveredEdit.status}`
    );

    await prisma.order.update({
      where: { id: orderCId },
      data: { status: "PAYMENT_SUBMITTED" },
    });
    const paidEdit = await api(`/api/orders/${orderCId}`, {
      method: "PATCH",
      token,
      body: { instructions: "no more edits" },
    });
    record(
      "E: editing after payment submission -> 409",
      paidEdit.status === 409,
      `status=${paidEdit.status}`
    );

    // ---- F. Orders: cancellation ------------------------------------------
    const cancelPending = await api(`/api/orders/${orderAId}/status`, {
      method: "PATCH",
      token,
      body: { status: "CANCELLED", notes: "Customer withdrew the request." },
    });
    const cancelHistory: Array<{ toStatus: string; notes: string | null }> =
      cancelPending.body?.data?.statusHistory ?? [];
    record(
      "F: cancel a PENDING order -> 200 with history + reason",
      cancelPending.status === 200 &&
        cancelPending.body?.data?.status === "CANCELLED" &&
        cancelHistory.some(
          (entry) =>
            entry.toStatus === "CANCELLED" &&
            entry.notes === "Customer withdrew the request."
        ),
      `status=${cancelPending.status}`
    );

    const cancelTwice = await api(`/api/orders/${orderAId}/status`, {
      method: "PATCH",
      token,
      body: { status: "CANCELLED" },
    });
    record(
      "F: cancelling twice -> 409",
      cancelTwice.status === 409,
      `status=${cancelTwice.status}`
    );

    const cancelDelivered = await api(`/api/orders/${orderBId}/status`, {
      method: "PATCH",
      token,
      body: { status: "CANCELLED" },
    });
    record(
      "F: cancelling a DELIVERED order -> 409",
      cancelDelivered.status === 409,
      `status=${cancelDelivered.status}`
    );

    const cancelPaid = await api(`/api/orders/${orderCId}/status`, {
      method: "PATCH",
      token,
      body: { status: "CANCELLED" },
    });
    record(
      "F: cancelling a PAYMENT_SUBMITTED order -> 200",
      cancelPaid.status === 200 &&
        cancelPaid.body?.data?.status === "CANCELLED",
      `status=${cancelPaid.status}`
    );

    const invalidTransition = await api(`/api/orders/${orderBId}/status`, {
      method: "PATCH",
      token,
      body: { status: "PROCESSING" },
    });
    record(
      "F: invalid transition DELIVERED -> PROCESSING -> 409",
      invalidTransition.status === 409,
      `status=${invalidTransition.status}`
    );

    const cancelAudit = await prisma.activityLog.findFirst({
      where: { action: "ORDER_CANCELLED", recordId: orderAId },
    });
    record(
      "F: cancellation recorded in the activity log with actor + reason",
      cancelAudit?.userId === dacsUser.id &&
        (cancelAudit?.metadata as any)?.reason ===
          "Customer withdrew the request.",
      cancelAudit ? "logged" : "missing"
    );

    // ---- G. Dashboard visuals ---------------------------------------------
    const createVisual = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "pie",
        title: "Orders by type",
        dataset: "orders",
        xField: "orderType",
        yField: "count",
        aggregation: "count",
      },
    });
    const visualId: string = createVisual.body?.data?.id;
    record(
      "G: create visual -> 201",
      createVisual.status === 201 && Boolean(visualId),
      `status=${createVisual.status}`
    );

    const invalidVisual = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: { visualType: "pie", title: "No value field" },
    });
    record(
      "G: builder visual without a Y field -> 400",
      invalidVisual.status === 400,
      `status=${invalidVisual.status}`
    );

    const builtinVisual = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: { visualType: "kpi", title: "Total PS Sales", builtin: "kpi-ps" },
    });
    const builtinVisualId: string = builtinVisual.body?.data?.id;
    record(
      "G: builtin visual without fields -> 201",
      builtinVisual.status === 201,
      `status=${builtinVisual.status}`
    );

    const updateVisual = await api(`/api/dashboard/visuals/${visualId}`, {
      method: "PATCH",
      token,
      body: { title: "Orders by type (edited)", visualType: "donut" },
    });
    record(
      "G: update visual -> 200",
      updateVisual.status === 200 &&
        updateVisual.body?.data?.title === "Orders by type (edited)" &&
        updateVisual.body?.data?.visualType === "donut",
      `status=${updateVisual.status}`
    );

    const reorderVisuals = await api("/api/dashboard/visuals/reorder", {
      method: "PATCH",
      token,
      body: { orderedVisualIds: [builtinVisualId, visualId] },
    });
    const reorderedVisuals: Array<{ id: string; displayOrder: number }> =
      reorderVisuals.body?.data ?? [];
    record(
      "G: reorder visuals -> 200, positions follow the list",
      reorderVisuals.status === 200 &&
        reorderedVisuals.find((visual) => visual.id === builtinVisualId)
          ?.displayOrder === 1 &&
        reorderedVisuals.find((visual) => visual.id === visualId)
          ?.displayOrder === 2,
      `status=${reorderVisuals.status}`
    );

    const reorderVisualsIncomplete = await api(
      "/api/dashboard/visuals/reorder",
      { method: "PATCH", token, body: { orderedVisualIds: [visualId] } }
    );
    record(
      "G: visual reorder missing an id -> 400",
      reorderVisualsIncomplete.status === 400,
      `status=${reorderVisualsIncomplete.status}`
    );

    const deleteVisual = await api(`/api/dashboard/visuals/${visualId}`, {
      method: "DELETE",
      token,
    });
    const listAfterDelete = await api("/api/dashboard/visuals", { token });
    record(
      "G: delete visual -> 200 and it disappears from the list",
      deleteVisual.status === 200 &&
        (listAfterDelete.body?.data ?? []).every(
          (visual: any) => visual.id !== visualId
        ),
      `status=${deleteVisual.status}`
    );

    const foreignVisual = await api(
      "/api/dashboard/visuals/00000000-0000-0000-0000-000000000000",
      { method: "PATCH", token, body: { title: "X" } }
    );
    record(
      "G: unknown visual id -> 404",
      foreignVisual.status === 404,
      `status=${foreignVisual.status}`
    );

    // Fill the dashboard to the cap (1 builtin remains from above).
    let capStatus = 0;
    for (let index = 0; index < 12; index += 1) {
      const fill = await api("/api/dashboard/visuals", {
        method: "POST",
        token,
        body: { visualType: "kpi", title: `Filler ${index}`, builtin: "kpi-ps" },
      });
      capStatus = fill.status;
      if (fill.status !== 201) break;
    }
    record(
      "G: the 13th visual is rejected -> 409",
      capStatus === 409,
      `lastStatus=${capStatus}`
    );

    // ---- H. Role-permission matrix ----------------------------------------
    const matrixDefaults = await api("/api/permissions", { token });
    const defaultGrants = matrixDefaults.body?.data?.grants ?? {};
    record(
      "H: GET matrix -> 200 with code defaults (IT staff denied Forms)",
      matrixDefaults.status === 200 &&
        defaultGrants["Forms"]?.IT_STAFF === false &&
        defaultGrants["Forms"]?.ADMINISTRATIVE_STAFF === true &&
        defaultGrants["User Management"]?.ADMINISTRATIVE_STAFF === false,
      `status=${matrixDefaults.status}`
    );

    const grantForms = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          { role: "IT_STAFF", permissionModule: "Forms", allowed: true },
        ],
      },
    });
    record(
      "H: owner grants IT staff the Forms module -> 200 + effective",
      grantForms.status === 200 &&
        grantForms.body?.data?.grants?.["Forms"]?.IT_STAFF === true,
      `status=${grantForms.status}`
    );

    const ownerRowAttempt = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          { role: "OWNER_EXECUTIVE", permissionModule: "Forms", allowed: false },
        ],
      },
    });
    record(
      "H: modifying the Owner row -> 400",
      ownerRowAttempt.status === 400,
      `status=${ownerRowAttempt.status}`
    );

    const unknownModule = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          { role: "IT_STAFF", permissionModule: "Not A Module", allowed: true },
        ],
      },
    });
    record(
      "H: unknown permission module -> 400",
      unknownModule.status === 400,
      `status=${unknownModule.status}`
    );

    // ---- I. Audit log read API --------------------------------------------
    const auditList = await api("/api/audit-logs?pageSize=5", { token });
    record(
      "I: GET audit logs -> 200, paginated, rows include the actor",
      auditList.status === 200 &&
        (auditList.body?.data ?? []).length === 5 &&
        auditList.body?.pagination?.pageSize === 5 &&
        auditList.body?.pagination?.total > 0 &&
        typeof auditList.body?.data?.[0]?.user?.email === "string",
      `count=${auditList.body?.data?.length}`
    );

    const auditFiltered = await api(
      "/api/audit-logs?module=SEMINARS&pageSize=50",
      { token }
    );
    const filteredRows: Array<{ module: string }> = auditFiltered.body?.data ?? [];
    record(
      "I: module filter returns only SEMINARS rows",
      auditFiltered.status === 200 &&
        filteredRows.length > 0 &&
        filteredRows.every((row) => row.module === "SEMINARS"),
      `count=${filteredRows.length}`
    );

    const auditSearch = await api(
      "/api/audit-logs?search=SEMINAR_VIDEOS_REORDERED",
      { token }
    );
    record(
      "I: search finds the reorder audit entry",
      auditSearch.status === 200 && (auditSearch.body?.data ?? []).length > 0,
      `count=${auditSearch.body?.data?.length}`
    );

    const auditByUser = await api(
      `/api/audit-logs?userId=${dacsUser.id}&action=ORDER_CANCELLED`,
      { token }
    );
    record(
      "I: user + action filters find the cancellation",
      auditByUser.status === 200 && (auditByUser.body?.data ?? []).length >= 2,
      `count=${auditByUser.body?.data?.length}`
    );

    // ---- J. RBAC: Administrative Staff ------------------------------------
    await setRole(dacsUser.id, "ADMINISTRATIVE_STAFF");

    const adminAudit = await api("/api/audit-logs", { token });
    record(
      "J: Administrative Staff cannot read audit logs -> 403",
      adminAudit.status === 403,
      `status=${adminAudit.status}`
    );

    const adminOwnRole = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          {
            role: "ADMINISTRATIVE_STAFF",
            permissionModule: "Historical Data",
            allowed: false,
          },
        ],
      },
    });
    record(
      "J: Administrative Staff cannot change their own role's grants -> 403",
      adminOwnRole.status === 403,
      `status=${adminOwnRole.status}`
    );

    const adminOtherRole = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          {
            role: "IT_STAFF",
            permissionModule: "Historical Data",
            allowed: true,
          },
        ],
      },
    });
    record(
      "J: Administrative Staff may manage other staff rows -> 200",
      adminOtherRole.status === 200,
      `status=${adminOtherRole.status}`
    );

    // ---- K. RBAC: IT staff + farmer ---------------------------------------
    await setRole(dacsUser.id, "IT_STAFF");

    /* IT staff may READ the matrix (their sessions gate admin pages on
       it) but must never be able to change it. */
    const itMatrix = await api("/api/permissions", { token });
    record(
      "K: IT staff can read the permission matrix -> 200",
      itMatrix.status === 200 && Boolean(itMatrix.body?.data?.grants),
      `status=${itMatrix.status}`
    );

    const itMatrixWrite = await api("/api/permissions", {
      method: "PATCH",
      token,
      body: {
        updates: [
          { role: "IT_STAFF", permissionModule: "Forms", allowed: true },
        ],
      },
    });
    record(
      "K: IT staff cannot change the permission matrix -> 403",
      itMatrixWrite.status === 403,
      `status=${itMatrixWrite.status}`
    );

    const itVisuals = await api("/api/dashboard/visuals", { token });
    record(
      "K: IT staff keep their own dashboard visuals -> 200",
      itVisuals.status === 200,
      `status=${itVisuals.status}`
    );

    await setRole(dacsUser.id, "CLIENT_FARMER");

    const farmerChecks: Array<[string, { status: number }]> = [
      [
        "question edit",
        await api(`/api/seminars/modules/${moduleId}/questions/${questionId}`, {
          method: "PATCH",
          token,
          body: { questionText: "hack?" },
        }),
      ],
      [
        "video edit",
        await api(`/api/seminars/modules/${moduleId}/videos/${videoAId}`, {
          method: "PATCH",
          token,
          body: { title: "hack" },
        }),
      ],
      [
        "video reorder",
        await api(`/api/seminars/modules/${moduleId}/videos/reorder`, {
          method: "PATCH",
          token,
          body: { orderedVideoIds: [videoAId, videoBId] },
        }),
      ],
      [
        "certificate template",
        await apiUpload(
          `/api/seminars/modules/${moduleId}/certificate-template`,
          token,
          "image",
          pngBuffer(),
          "hack.png",
          "image/png"
        ),
      ],
      [
        "customer admin edit",
        await api(`/api/customers/${profile.id}`, {
          method: "PATCH",
          token,
          body: { occupation: "hack" },
        }),
      ],
      [
        "audit logs",
        await api("/api/audit-logs", { token }),
      ],
      [
        "dashboard visuals",
        await api("/api/dashboard/visuals", {
          method: "POST",
          token,
          body: { visualType: "kpi", title: "hack", builtin: "kpi-ps" },
        }),
      ],
      [
        "permission matrix",
        await api("/api/permissions", { token }),
      ],
    ];

    record(
      "K: farmer is denied every administrative endpoint -> all 403",
      farmerChecks.every(([, response]) => response.status === 403),
      farmerChecks
        .filter(([, response]) => response.status !== 403)
        .map(([label, response]) => `${label}=${response.status}`)
        .join(", ") || "all 403"
    );
  } finally {
    // ---- Cleanup ----------------------------------------------------------
    await setRole(dacsUser.id, originalRole);
    await prisma.customerProfile.update({
      where: { id: profile.id },
      data: { occupation: originalOccupation },
    });
    await cleanupFixtures(dacsUser.id);

    if (certificateTemplateUrl) {
      try {
        const pathname = new URL(certificateTemplateUrl).pathname;
        const relativePath = decodeURIComponent(
          pathname.replace(/^\/uploads\//, "")
        );
        await unlink(
          path.resolve(
            process.cwd(),
            process.env.UPLOADS_DIR ?? "uploads",
            relativePath
          )
        );
      } catch {
        // Best effort; a leftover test image is harmless.
      }
    }

    record("Fixtures cleaned up, role restored", true, originalRole);
  }

  return finish();
}

main()
  .catch((error) => {
    console.error("Integration-gap test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
