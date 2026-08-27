/**
 * Paid seminar module verification: prices on modules, Add to Cart ->
 * normal DACS checkout -> staff approval -> payment verification ->
 * module unlock, all through the real order workflow.
 *
 *   - seminar_modules.price set through the staff module API (0 = free)
 *   - SEMINAR orders: OQ-SEM numbering, quantity-1 module items with
 *     checkout-time price snapshots, coexisting with product orders
 *   - duplicate-purchase protection (pending AND owned), free modules
 *     not purchasable, cross-type item rejection
 *   - access rule enforced by the content APIs (video progress, quiz
 *     read, quiz submit) and by video-URL stripping in the catalog:
 *       free module:  every lower published module completed
 *       paid module:  lower modules completed AND an order that reached
 *                     PAYMENT_VERIFIED (staff approve + record payment)
 *   - purchase without prerequisite stays locked until the previous
 *     module is completed — then unlocks with no further approval
 *   - staff price edits never touch existing orders (snapshots)
 *
 * Fixture modules use numbers 96 (free) and 97 (paid) and are created
 * fresh through the staff API each run — proving future modules inherit
 * the whole system with no code changes. Cleanup removes the fixture
 * farmer's orders/enrollments and both modules.
 *
 * Prerequisites: TEST server (npm run dev:test), staff seeded.
 * Run: npx tsx scripts/test-seminar-purchases.ts
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const CREDENTIALS_FILE =
  "C:/Users/Ella Ignacio/DACS-secrets/admin-staff-credentials.txt";
const PROJECT_ID = "dacs-8f430";
const OWNER_EMAIL = "erwinjoseph.cruz@dominantasia.com";
const FARMER_EMAIL = "dacs.seminar.buyer@dacs-test.example";

const FREE_MODULE_NUMBER = 96;
const PAID_MODULE_NUMBER = 97;
const PAID_PRICE = 2600;

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function record(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(
  pathName: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
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
  const appsBody = (await appsResponse.json()) as {
    apps?: Array<{ name: string }>;
  };
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

async function ensureFirebaseUser(email: string) {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  try {
    return await firebaseAuth.getUserByEmail(email);
  } catch {
    return firebaseAuth.createUser({ email, emailVerified: true });
  }
}

async function ensureProfile(token: string): Promise<void> {
  const existing = await api("/api/customers/me", { token });
  if (existing.status === 200) return;
  const created = await api("/api/customers/me", {
    method: "POST",
    token,
    body: {
      firstName: "Seminar",
      lastName: "Buyer",
      occupation: "Poultry Farmer",
      addressLine1: "Purchase Suite Street",
      cityMunicipality: "Sample City",
      province: "Sample Province",
    },
  });
  if (created.status !== 201) {
    throw new Error(
      `Could not create fixture profile: ${created.status} ${created.body?.message ?? ""}`
    );
  }
}

/* Published lower modules must exist for the prerequisite chain; the
   suite marks them completed for the fixture farmer directly (their
   API-path completion is covered by test-backend / test-certificates). */
async function ensureLowerModule(moduleNumber: number) {
  let module = await prisma.seminarModule.findUnique({ where: { moduleNumber } });
  if (!module) {
    module = await prisma.seminarModule.create({
      data: {
        moduleNumber,
        title: `Purchase Suite Module ${moduleNumber}`,
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
  return module;
}

async function cleanupFixture(profileId: string | null): Promise<void> {
  if (profileId) {
    await prisma.payment.deleteMany({
      where: { order: { customerProfileId: profileId, orderType: "SEMINAR" } },
    });
    await prisma.order.deleteMany({
      where: { customerProfileId: profileId, orderType: "SEMINAR" },
    });
    await prisma.seminarEnrollment.deleteMany({
      where: { customerProfileId: profileId },
    });
  }
  for (const moduleNumber of [FREE_MODULE_NUMBER, PAID_MODULE_NUMBER]) {
    const module = await prisma.seminarModule.findUnique({
      where: { moduleNumber },
      select: { id: true },
    });
    if (!module) continue;
    await prisma.seminarEnrollment.deleteMany({
      where: { moduleId: module.id },
    });
    const purchases = await prisma.orderItem.findMany({
      where: { seminarModuleId: module.id },
      select: { orderId: true },
    });
    if (purchases.length > 0) {
      const orderIds = [...new Set(purchases.map((item) => item.orderId))];
      await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.seminarModule.delete({ where: { id: module.id } });
  }
}

function finish(): void {
  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`
  );
  if (failed.length) {
    console.log("Failed checks:");
    for (const failure of failed) {
      console.log(
        `  - ${failure.name}${failure.detail ? ` (${failure.detail})` : ""}`
      );
    }
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log(`\nPaid seminar module verification against ${BASE_URL}\n`);
  await assertTestServer();
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");

  const apiKey = await getWebApiKey();
  const staffToken = await signInWithPassword(
    apiKey,
    OWNER_EMAIL,
    loadPassword(OWNER_EMAIL)
  );

  // ---- Fixture farmer -----------------------------------------------------
  const farmerFirebase = await ensureFirebaseUser(FARMER_EMAIL);
  let farmerToken = await mintIdToken(apiKey, farmerFirebase.uid);
  await api("/api/auth/sync", { method: "POST", token: farmerToken });
  const farmerUser = await prisma.user.findUnique({
    where: { firebaseUid: farmerFirebase.uid },
  });
  if (!farmerUser) {
    record("Fixture farmer synced", false);
    return finish();
  }
  await prisma.user.update({
    where: { id: farmerUser.id },
    data: { role: "CLIENT_FARMER" },
  });
  await ensureProfile(farmerToken);
  const profile = await prisma.customerProfile.findFirst({
    where: { userId: farmerUser.id, archivedAt: null },
    select: { id: true, customerNumber: true },
  });
  if (!profile) {
    record("Fixture profile ready", false);
    return finish();
  }
  record("Fixture farmer ready", true, profile.customerNumber);

  await cleanupFixture(profile.id);

  // ---- Fixture modules through the STAFF API (future-module proof) --------
  const priceRejected = await api("/api/seminars/modules", {
    method: "POST",
    token: staffToken,
    body: {
      moduleNumber: PAID_MODULE_NUMBER,
      title: "Bad Price",
      passingScore: 50,
      price: -5,
    },
  });
  record(
    "POST module with negative price -> 400",
    priceRejected.status === 400,
    priceRejected.body?.message ?? `status ${priceRejected.status}`
  );

  const createdFree = await api("/api/seminars/modules", {
    method: "POST",
    token: staffToken,
    body: {
      moduleNumber: FREE_MODULE_NUMBER,
      title: `Module ${FREE_MODULE_NUMBER}: Purchase Suite Free Module`,
      passingScore: 50,
      price: 0,
    },
  });
  const createdPaid = await api("/api/seminars/modules", {
    method: "POST",
    token: staffToken,
    body: {
      moduleNumber: PAID_MODULE_NUMBER,
      title: `Module ${PAID_MODULE_NUMBER}: Purchase Suite Paid Module`,
      passingScore: 50,
      price: PAID_PRICE,
    },
  });
  const freeModule = createdFree.body?.data;
  const paidModule = createdPaid.body?.data;
  record(
    "Staff create modules with Module Price (0 and 2600) -> 201",
    createdFree.status === 201 &&
      createdPaid.status === 201 &&
      Number(freeModule?.price) === 0 &&
      Number(paidModule?.price) === PAID_PRICE,
    `free=${freeModule?.price} paid=${paidModule?.price}`
  );
  if (!freeModule?.id || !paidModule?.id) return finish();

  const fixtureVideos: Record<string, string> = {};
  for (const module of [freeModule, paidModule]) {
    const video = await api(`/api/seminars/modules/${module.id}/videos`, {
      method: "POST",
      token: staffToken,
      body: {
        title: `Module ${module.moduleNumber} Lecture`,
        videoUrl: `https://videos.dacs.example/purchase-suite-${module.moduleNumber}.mp4`,
        displayOrder: 1,
      },
    });
    fixtureVideos[module.id] = video.body?.data?.id;
    await api(`/api/seminars/modules/${module.id}/questions`, {
      method: "POST",
      token: staffToken,
      body: {
        questionText: `Module ${module.moduleNumber}: ready?`,
        points: 1,
        choices: [
          { choiceText: "Yes", isCorrect: true, displayOrder: 1 },
          { choiceText: "No", isCorrect: false, displayOrder: 2 },
        ],
      },
    });
    await api(`/api/seminars/modules/${module.id}`, {
      method: "PATCH",
      token: staffToken,
      body: { isPublished: true },
    });
  }
  record(
    "Fixture modules published with content",
    Boolean(fixtureVideos[freeModule.id] && fixtureVideos[paidModule.id])
  );

  // ---- Prerequisite chain: complete every lower published module ----------
  for (const moduleNumber of [1, 2, 3]) {
    await ensureLowerModule(moduleNumber);
  }
  const lowerModules = await prisma.seminarModule.findMany({
    where: {
      isPublished: true,
      archivedAt: null,
      moduleNumber: { lt: FREE_MODULE_NUMBER },
    },
    select: { id: true },
  });
  for (const lower of lowerModules) {
    await prisma.seminarEnrollment.upsert({
      where: {
        customerProfileId_moduleId: {
          customerProfileId: profile.id,
          moduleId: lower.id,
        },
      },
      create: {
        customerProfileId: profile.id,
        moduleId: lower.id,
        completedAt: new Date(),
      },
      update: { completedAt: new Date() },
    });
  }
  record(
    "Lower published modules marked completed for the fixture farmer",
    lowerModules.length > 0,
    `${lowerModules.length} modules`
  );

  // ---- Catalog + progress before any purchase ----------------------------
  const catalogBefore = await api("/api/seminars/modules", { token: farmerToken });
  const catalogPaid = (catalogBefore.body?.data ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  const catalogFree = (catalogBefore.body?.data ?? []).find(
    (entry: any) => entry.moduleNumber === FREE_MODULE_NUMBER
  );
  record(
    "Farmer catalog carries module prices",
    Number(catalogFree?.price) === 0 && Number(catalogPaid?.price) === PAID_PRICE,
    `free=${catalogFree?.price} paid=${catalogPaid?.price}`
  );
  record(
    "Locked paid module's video URLs stripped from the catalog",
    catalogPaid?.videos?.length === 1 && catalogPaid?.videos?.[0]?.videoUrl === null,
    `videoUrl=${String(catalogPaid?.videos?.[0]?.videoUrl)}`
  );
  record(
    "Accessible free module keeps its video URLs",
    catalogFree?.videos?.[0]?.videoUrl?.includes("purchase-suite") === true
  );

  const progressBefore = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidBefore = (progressBefore.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  const freeBefore = (progressBefore.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === FREE_MODULE_NUMBER
  );
  record(
    "Progress: free module NOT_REQUIRED + accessible (prereqs done)",
    freeBefore?.isFree === true &&
      freeBefore?.purchaseStatus === "NOT_REQUIRED" &&
      freeBefore?.prerequisiteCompleted === true &&
      freeBefore?.accessible === true,
    `status=${freeBefore?.purchaseStatus} accessible=${freeBefore?.accessible}`
  );
  record(
    "Progress: paid module NOT_PURCHASED + locked (prereq 96 incomplete)",
    paidBefore?.isFree === false &&
      paidBefore?.purchaseStatus === "NOT_PURCHASED" &&
      paidBefore?.prerequisiteCompleted === false &&
      paidBefore?.prerequisiteModuleNumber === FREE_MODULE_NUMBER &&
      paidBefore?.accessible === false,
    `status=${paidBefore?.purchaseStatus} prereq=${paidBefore?.prerequisiteCompleted}`
  );

  // ---- Locked content rejects direct API access ---------------------------
  const lockedQuiz = await api(
    `/api/seminars/modules/${paidModule.id}/quiz`,
    { token: farmerToken }
  );
  record(
    "GET locked paid module quiz -> 403",
    lockedQuiz.status === 403,
    lockedQuiz.body?.message ?? `status ${lockedQuiz.status}`
  );
  const lockedProgress = await api(
    `/api/seminars/videos/${fixtureVideos[paidModule.id]}/progress`,
    { method: "PATCH", token: farmerToken, body: { progressPercent: 50 } }
  );
  record(
    "PATCH locked paid module video progress -> 403",
    lockedProgress.status === 403,
    lockedProgress.body?.message ?? `status ${lockedProgress.status}`
  );
  const lockedSubmit = await api(
    `/api/seminars/modules/${paidModule.id}/quiz`,
    { method: "POST", token: farmerToken, body: { answers: [] } }
  );
  record(
    "POST locked paid module quiz -> 403",
    lockedSubmit.status === 403,
    lockedSubmit.body?.message ?? `status ${lockedSubmit.status}`
  );

  // ---- Checkout guards ----------------------------------------------------
  const freePurchase = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      items: [{ seminarModuleId: freeModule.id, quantity: 1 }],
    },
  });
  record(
    "Buying a FREE module -> 400",
    freePurchase.status === 400,
    freePurchase.body?.message ?? `status ${freePurchase.status}`
  );

  const doubleQuantity = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      items: [{ seminarModuleId: paidModule.id, quantity: 2 }],
    },
  });
  record(
    "Seminar quantity 2 -> 400 (access is one per customer)",
    doubleQuantity.status === 400,
    doubleQuantity.body?.message ?? `status ${doubleQuantity.status}`
  );

  const productInSeminarOrder = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      items: [
        { productId: "00000000-0000-4000-8000-000000000000", quantity: 1 },
      ],
    },
  });
  record(
    "Product item inside a SEMINAR order -> 400",
    productInSeminarOrder.status === 400,
    productInSeminarOrder.body?.message ?? `status ${productInSeminarOrder.status}`
  );

  const seminarInProductOrder = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "VETERINARY_PRODUCT",
      items: [{ seminarModuleId: paidModule.id, quantity: 1 }],
    },
  });
  record(
    "Seminar item inside a product order -> 400",
    seminarInProductOrder.status === 400,
    seminarInProductOrder.body?.message ?? `status ${seminarInProductOrder.status}`
  );

  // ---- The real purchase (spec: buying ahead of the prerequisite) --------
  const purchase = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      receiverName: "Seminar Buyer",
      items: [{ seminarModuleId: paidModule.id, quantity: 1 }],
    },
  });
  const order = purchase.body?.data;
  record(
    "Checkout SEMINAR order -> 201, OQ-SEM number, ₱2600 snapshot",
    purchase.status === 201 &&
      /^OQ-SEM-\d{4}-\d{3,}$/.test(order?.orderNumber ?? "") &&
      Number(order?.totalAmount) === PAID_PRICE &&
      order?.items?.[0]?.itemType === "SEMINAR_MODULE" &&
      order?.items?.[0]?.seminarModuleId === paidModule.id &&
      order?.items?.[0]?.quantity === 1 &&
      order?.items?.[0]?.productNameSnapshot === paidModule.title,
    `${order?.orderNumber ?? "no order"} total=${order?.totalAmount}`
  );
  if (!order?.id) return finish();

  const duplicateWhilePending = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      items: [{ seminarModuleId: paidModule.id, quantity: 1 }],
    },
  });
  record(
    "Second purchase while order pending -> 409",
    duplicateWhilePending.status === 409,
    duplicateWhilePending.body?.message ?? `status ${duplicateWhilePending.status}`
  );

  const historyPending = await api("/api/orders/me", { token: farmerToken });
  const historyRow = (historyPending.body?.data ?? []).find(
    (entry: any) => entry.id === order.id
  );
  record(
    "Order History shows the seminar order (type SEMINAR, PENDING)",
    historyRow?.orderType === "SEMINAR" && historyRow?.status === "PENDING",
    `${historyRow?.orderNumber} ${historyRow?.status}`
  );

  const staffOrders = await api("/api/orders", { token: staffToken });
  const staffRow = (staffOrders.body?.data ?? []).find(
    (entry: any) => entry.id === order.id
  );
  record(
    "Admin order table shows the seminar order with customer + module",
    staffRow?.orderType === "SEMINAR" &&
      staffRow?.customerProfile?.customerNumber === profile.customerNumber &&
      staffRow?.items?.[0]?.productNameSnapshot === paidModule.title,
    `${staffRow?.orderNumber ?? "missing"}`
  );

  const progressPending = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidPending = (progressPending.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  record(
    "Progress: purchase PENDING, module still locked",
    paidPending?.purchaseStatus === "PENDING" &&
      paidPending?.purchaseOrderNumber === order.orderNumber &&
      paidPending?.accessible === false,
    `status=${paidPending?.purchaseStatus}`
  );

  // ---- Staff approval alone must NOT unlock (money not verified) ---------
  const approve = await api(`/api/orders/${order.id}/status`, {
    method: "PATCH",
    token: staffToken,
    body: { status: "APPROVED" },
  });
  record(
    "Staff approve seminar order -> 200",
    approve.status === 200 && approve.body?.data?.status === "APPROVED"
  );

  const editItems = await api(`/api/orders/${order.id}`, {
    method: "PATCH",
    token: staffToken,
    body: {
      items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
    },
  });
  record(
    "Staff editing seminar order items -> 409 (fixed at checkout)",
    editItems.status === 409,
    editItems.body?.message ?? `status ${editItems.status}`
  );

  const quizAfterApprove = await api(
    `/api/seminars/modules/${paidModule.id}/quiz`,
    { token: farmerToken }
  );
  record(
    "APPROVED (unpaid) keeps the module locked -> 403",
    quizAfterApprove.status === 403,
    quizAfterApprove.body?.message ?? `status ${quizAfterApprove.status}`
  );

  // ---- Payment verification grants ownership -----------------------------
  const recordPayment = await api(`/api/payments/orders/${order.id}/record`, {
    method: "POST",
    token: staffToken,
    body: {
      paymentType: "FULL",
      amount: PAID_PRICE,
      referenceNumber: "GCASH-PURCHASE-SUITE",
      notes: "Purchase suite emailed proof.",
    },
  });
  record(
    "Staff record FULL payment -> order PAYMENT_VERIFIED",
    recordPayment.status === 201 &&
      recordPayment.body?.orderStatusUpdated === true,
    `updated=${recordPayment.body?.orderStatusUpdated}`
  );

  const progressOwned = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidOwned = (progressOwned.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  record(
    "Ownership recognized immediately after payment verification",
    paidOwned?.purchaseStatus === "OWNED",
    `status=${paidOwned?.purchaseStatus}`
  );
  record(
    "Owned but prerequisite incomplete -> still locked (independent gates)",
    paidOwned?.accessible === false && paidOwned?.prerequisiteCompleted === false,
    `accessible=${paidOwned?.accessible}`
  );

  const quizOwnedLocked = await api(
    `/api/seminars/modules/${paidModule.id}/quiz`,
    { token: farmerToken }
  );
  record(
    "Owned module content still 403 while Module 96 incomplete",
    quizOwnedLocked.status === 403,
    quizOwnedLocked.body?.message ?? `status ${quizOwnedLocked.status}`
  );

  const duplicateWhileOwned = await api("/api/orders", {
    method: "POST",
    token: farmerToken,
    body: {
      orderType: "SEMINAR",
      items: [{ seminarModuleId: paidModule.id, quantity: 1 }],
    },
  });
  record(
    "Buying an owned module again -> 409",
    duplicateWhileOwned.status === 409,
    duplicateWhileOwned.body?.message ?? `status ${duplicateWhileOwned.status}`
  );

  // ---- Complete the free prerequisite module through the API -------------
  const startFree = await api(`/api/seminars/modules/${freeModule.id}/start`, {
    method: "POST",
    token: farmerToken,
  });
  const freeVideoDone = await api(
    `/api/seminars/videos/${fixtureVideos[freeModule.id]}/progress`,
    { method: "PATCH", token: farmerToken, body: { progressPercent: 100 } }
  );
  const freeQuizPayload = await api(
    `/api/seminars/modules/${freeModule.id}/quiz`,
    { token: farmerToken }
  );
  const freeQuestion = freeQuizPayload.body?.data?.questions?.[0];
  const freeChoices = await prisma.seminarChoice.findMany({
    where: { questionId: freeQuestion?.id ?? "" },
    select: { id: true, isCorrect: true },
  });
  const freeSubmit = await api(`/api/seminars/modules/${freeModule.id}/quiz`, {
    method: "POST",
    token: farmerToken,
    body: {
      answers: [
        {
          questionId: freeQuestion?.id,
          choiceId: freeChoices.find((choice) => choice.isCorrect)?.id,
        },
      ],
    },
  });
  record(
    "Free module taken normally (no payment): video + quiz -> completed",
    startFree.status === 200 &&
      freeVideoDone.status === 200 &&
      freeSubmit.status === 200 &&
      freeSubmit.body?.data?.moduleCompleted === true,
    `completed=${freeSubmit.body?.data?.moduleCompleted}`
  );

  // ---- Both gates satisfied: unlocks automatically, no extra approval ----
  const progressUnlocked = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidUnlocked = (progressUnlocked.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  record(
    "Prerequisite done + OWNED -> accessible automatically",
    paidUnlocked?.accessible === true &&
      paidUnlocked?.prerequisiteCompleted === true &&
      paidUnlocked?.purchaseStatus === "OWNED",
    `accessible=${paidUnlocked?.accessible}`
  );

  const catalogAfter = await api("/api/seminars/modules", { token: farmerToken });
  const catalogPaidAfter = (catalogAfter.body?.data ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  record(
    "Unlocked module's video URLs restored in the catalog",
    catalogPaidAfter?.videos?.[0]?.videoUrl?.includes("purchase-suite") === true
  );

  const paidVideoProgress = await api(
    `/api/seminars/videos/${fixtureVideos[paidModule.id]}/progress`,
    { method: "PATCH", token: farmerToken, body: { progressPercent: 100 } }
  );
  const paidQuizPayload = await api(
    `/api/seminars/modules/${paidModule.id}/quiz`,
    { token: farmerToken }
  );
  const paidQuestion = paidQuizPayload.body?.data?.questions?.[0];
  const paidChoices = await prisma.seminarChoice.findMany({
    where: { questionId: paidQuestion?.id ?? "" },
    select: { id: true, isCorrect: true },
  });
  const paidSubmit = await api(`/api/seminars/modules/${paidModule.id}/quiz`, {
    method: "POST",
    token: farmerToken,
    body: {
      answers: [
        {
          questionId: paidQuestion?.id,
          choiceId: paidChoices.find((choice) => choice.isCorrect)?.id,
        },
      ],
    },
  });
  record(
    "Purchased module taken end to end: video + quiz -> completed",
    paidVideoProgress.status === 200 &&
      paidQuizPayload.status === 200 &&
      paidSubmit.status === 200 &&
      paidSubmit.body?.data?.moduleCompleted === true,
    `completed=${paidSubmit.body?.data?.moduleCompleted}`
  );

  // ---- Persistence: fresh sign-in sees the same state --------------------
  farmerToken = await mintIdToken(apiKey, farmerFirebase.uid);
  const progressFresh = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidFresh = (progressFresh.body?.data?.modules ?? []).find(
    (entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER
  );
  record(
    "Fresh sign-in: purchase + access persist (backend truth)",
    paidFresh?.purchaseStatus === "OWNED" && paidFresh?.accessible === true,
    `status=${paidFresh?.purchaseStatus} accessible=${paidFresh?.accessible}`
  );

  // ---- Later price change never touches the existing order ---------------
  const priceChange = await api(`/api/seminars/modules/${paidModule.id}`, {
    method: "PATCH",
    token: staffToken,
    body: { price: 2900 },
  });
  const orderAfterPriceChange = await api(`/api/orders/${order.id}`, {
    token: staffToken,
  });
  const progressAfterPriceChange = await api("/api/seminars/me/progress", {
    token: farmerToken,
  });
  const paidAfterPrice = (
    progressAfterPriceChange.body?.data?.modules ?? []
  ).find((entry: any) => entry.moduleNumber === PAID_MODULE_NUMBER);
  record(
    "Staff price change (2600 -> 2900) keeps the order snapshot and access",
    priceChange.status === 200 &&
      Number(orderAfterPriceChange.body?.data?.items?.[0]?.unitPriceSnapshot) ===
        PAID_PRICE &&
      Number(orderAfterPriceChange.body?.data?.totalAmount) === PAID_PRICE &&
      paidAfterPrice?.purchaseStatus === "OWNED" &&
      paidAfterPrice?.accessible === true,
    `snapshot=${orderAfterPriceChange.body?.data?.items?.[0]?.unitPriceSnapshot}`
  );

  // ---- Farmer payment history includes the recorded seminar payment ------
  const myPayments = await api("/api/payments/me", { token: farmerToken });
  const seminarPayment = (myPayments.body?.data ?? []).find(
    (entry: any) => entry.order?.id === order.id
  );
  record(
    "Farmer payment history shows the verified seminar payment",
    seminarPayment?.status === "VERIFIED" &&
      Number(seminarPayment?.amount) === PAID_PRICE,
    `status=${seminarPayment?.status}`
  );

  // ---- Cleanup ------------------------------------------------------------
  await cleanupFixture(profile.id);
  const leftoverModules = await prisma.seminarModule.count({
    where: { moduleNumber: { in: [FREE_MODULE_NUMBER, PAID_MODULE_NUMBER] } },
  });
  record("Fixture cleanup removed modules + orders", leftoverModules === 0);

  finish();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
