/**
 * DACS live security audit harness (Part 2 of the pre-deployment audit).
 *
 * Attacks the RUNNING backend the way a hostile client would: missing /
 * garbage / disabled-account tokens, farmer-to-admin RBAC escalation,
 * IDOR/BOLA across two disposable synthetic farmers, price/total
 * injection, Parent-Stock eligibility bypass, and malformed input.
 *
 * SAFETY: uses only disposable @dacs-sec.example accounts it creates and
 * fully deletes at the end. It never touches lemonyfroggo@gmail.com, the
 * staff accounts, the shared fixture, or any migrated historical data.
 *
 * Prereqs: backend on :5000, staff seeded, DACS-secrets credentials file.
 * Run: npx tsx scripts/test-security-audit.ts
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

const FARMER_A_EMAIL = "dacs.sec.farmera@dacs-sec.example";
const FARMER_B_EMAIL = "dacs.sec.farmerb@dacs-sec.example";
const DISABLED_EMAIL = "dacs.sec.disabled@dacs-sec.example";
const UNSYNCED_EMAIL = "dacs.sec.unsynced@dacs-sec.example";

interface TestResult {
  section: string;
  name: string;
  pass: boolean;
  detail: string;
}
const results: TestResult[] = [];

function record(
  section: string,
  name: string,
  pass: boolean,
  detail = ""
): void {
  results.push({ section, name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}  [${section}] ${name}${detail ? ` — ${detail}` : ""}`
  );
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
    /* non-JSON */
  }
  return { status: response.status, body };
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function uploadProof(
  token: string | undefined,
  orderId: string,
  fields: Record<string, string>
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("proof", new Blob([TINY_PNG], { type: "image/png" }), "p.png");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `${BASE_URL}/api/payments/orders/${orderId}/proof`,
    { method: "POST", headers, body: form }
  );
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body };
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
  const body = (await response.json()) as {
    idToken?: string;
    error?: { message?: string };
  };
  if (!body.idToken)
    throw new Error(`Password sign-in failed for ${email}: ${body.error?.message}`);
  return body.idToken;
}

async function mintFarmerToken(
  apiKey: string,
  email: string
): Promise<{ token: string; uid: string }> {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  let user;
  try {
    user = await firebaseAuth.getUserByEmail(email);
    if (!user.emailVerified)
      await firebaseAuth.updateUser(user.uid, { emailVerified: true });
  } catch {
    user = await firebaseAuth.createUser({
      email,
      emailVerified: true,
      password: "DacsSec1234!",
    });
  }
  const customToken = await firebaseAuth.createCustomToken(user.uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`Could not mint token for ${email}.`);
  return { token: body.idToken, uid: user.uid };
}

function loadPassword(email: string): string {
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (match && match[1].toLowerCase() === email.toLowerCase()) return match[2];
  }
  throw new Error(`No password for ${email} in ${CREDENTIALS_FILE}`);
}

/*
 * Audit product fixtures. The audit used to hardcode the dev catalog's
 * row UUIDs; now that suites run against the isolated test database it
 * creates its own disposable products (SEC-AUDIT-* codes) and removes
 * them at cleanup. Prices mirror the checks below (825 x 3 = 2475, and
 * a high price for the numeric-overflow attempt).
 */
let VET_ADECTROL_ID = "";
let VET_GLUTA_ID = "";
let PS_D853_ID = "";

const AUDIT_PRODUCTS = [
  { code: "SEC-AUDIT-VET-825", name: "Sec Audit Vet 825", category: "VETERINARY_PRODUCT", unitPrice: 825 },
  { code: "SEC-AUDIT-VET-1400", name: "Sec Audit Vet 1400", category: "VETERINARY_PRODUCT", unitPrice: 1400 },
  { code: "SEC-AUDIT-PS", name: "Sec Audit Parent Stock", category: "PARENT_STOCK", unitPrice: 1000 },
] as const;

async function ensureAuditProducts(): Promise<void> {
  const ids: string[] = [];
  for (const fixture of AUDIT_PRODUCTS) {
    const row = await prisma.product.upsert({
      where: { productCode: fixture.code },
      update: { unitPrice: fixture.unitPrice, isActive: true },
      create: {
        id: crypto.randomUUID(),
        productCode: fixture.code,
        name: fixture.name,
        category: fixture.category,
        unit: "unit",
        unitPrice: fixture.unitPrice,
        updatedAt: new Date(),
      },
    });
    ids.push(row.id);
  }
  [VET_ADECTROL_ID, VET_GLUTA_ID, PS_D853_ID] = ids;
}

async function cleanupAuditProducts(): Promise<void> {
  // Order items referencing these products are removed by
  // cleanupFarmer() first (Restrict FK), so a plain delete works here.
  await prisma.product.deleteMany({
    where: { productCode: { in: AUDIT_PRODUCTS.map((p) => p.code) } },
  });
}

async function cleanupFarmer(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const profile = await prisma.customerProfile.findUnique({
      where: { userId: user.id },
    });
    if (profile) {
      const orders = await prisma.order.findMany({
        where: { customerProfileId: profile.id },
        select: { id: true },
      });
      const orderIds = orders.map((o) => o.id);
      if (orderIds.length) {
        await prisma.paymentStatusHistory.deleteMany({
          where: { payment: { orderId: { in: orderIds } } },
        });
        await prisma.payment.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        await prisma.orderStatusHistory.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        await prisma.orderItem.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      await prisma.ticketStatusHistory.deleteMany({
        where: { ticket: { customerProfileId: profile.id } },
      });
      await prisma.inquiryTicket.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await prisma.farm.deleteMany({ where: { customerProfileId: profile.id } });
      await prisma.customerProfile.delete({ where: { id: profile.id } });
    }
    await prisma.notification.deleteMany({ where: { userId: user.id } });
    await prisma.notificationPreference.deleteMany({
      where: { userId: user.id },
    });
    await prisma.dashboardVisual.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  if (firebaseAuth) {
    try {
      const fb = await firebaseAuth.getUserByEmail(email);
      await firebaseAuth.deleteUser(fb.uid);
    } catch {
      /* not present */
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nDACS LIVE SECURITY AUDIT against ${BASE_URL}\n`);
  await assertTestServer();

  const apiKey = await getWebApiKey();

  // Fresh start for the disposable accounts.
  for (const e of [FARMER_A_EMAIL, FARMER_B_EMAIL, DISABLED_EMAIL, UNSYNCED_EMAIL])
    await cleanupFarmer(e);

  // Disposable audit products (created in the test database only).
  await ensureAuditProducts();

  const owner = await signInWithPassword(
    apiKey,
    "erwinjoseph.cruz@dominantasia.com",
    loadPassword("erwinjoseph.cruz@dominantasia.com")
  );
  const adminStaff = await signInWithPassword(
    apiKey,
    "adrian.calalang@dominantasia.com",
    loadPassword("adrian.calalang@dominantasia.com")
  );
  const itStaff = await signInWithPassword(
    apiKey,
    "mhikaela.galo@dominantasia.com",
    loadPassword("mhikaela.galo@dominantasia.com")
  );
  for (const t of [owner, adminStaff, itStaff])
    await api("/api/auth/sync", { method: "POST", token: t });

  const farmerA = await mintFarmerToken(apiKey, FARMER_A_EMAIL);
  const farmerB = await mintFarmerToken(apiKey, FARMER_B_EMAIL);
  await api("/api/auth/sync", { method: "POST", token: farmerA.token });
  await api("/api/auth/sync", { method: "POST", token: farmerB.token });

  // Profiles for A and B.
  await api("/api/customers/me", {
    method: "POST",
    token: farmerA.token,
    body: { firstName: "SecTest", lastName: "FarmerA", contactEmail: FARMER_A_EMAIL },
  });
  await api("/api/customers/me", {
    method: "POST",
    token: farmerB.token,
    body: { firstName: "SecTest", lastName: "FarmerB", contactEmail: FARMER_B_EMAIL },
  });
  // Farm for A.
  await api("/api/farms", {
    method: "POST",
    token: farmerA.token,
    body: { farmName: "Sec Test Farm A", region: "Region III" },
  });
  // VET order for A (IDOR target).
  const orderA = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: {
      orderType: "VETERINARY_PRODUCT",
      fulfillmentMethod: "PICKUP",
      items: [{ productId: VET_ADECTROL_ID, quantity: 2 }],
    },
  });
  const orderAId = orderA.body?.data?.id as string | undefined;
  // Inquiry for A (IDOR target).
  const inquiryA = await api("/api/inquiries", {
    method: "POST",
    token: farmerA.token,
    body: { subject: "Sec test A", message: "Private message for farmer A only." },
  });
  const inquiryAId = inquiryA.body?.data?.id as string | undefined;

  record(
    "setup",
    "Farmer A order + inquiry created",
    Boolean(orderAId) && Boolean(inquiryAId),
    `order=${orderA.status} inquiry=${inquiryA.status}`
  );

  // ==================================================================
  // A. AUTHENTICATION
  // ==================================================================
  const noTok = await api("/api/customers/me");
  record("A-auth", "No token -> 401", noTok.status === 401, `status ${noTok.status}`);

  const garbage = await api("/api/customers/me", { token: "not-a-real-token" });
  record("A-auth", "Garbage token -> 401", garbage.status === 401, `status ${garbage.status}`);

  const malformedJwt = await api("/api/customers/me", {
    token: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.fakesig",
  });
  record(
    "A-auth",
    "Forged/malformed JWT -> 401",
    malformedJwt.status === 401,
    `status ${malformedJwt.status}`
  );

  // Valid Firebase token but never synced -> loadDacsUser 403.
  const unsynced = await mintFarmerToken(apiKey, UNSYNCED_EMAIL);
  const unsyncedHit = await api("/api/customers/me", { token: unsynced.token });
  record(
    "A-auth",
    "Valid token, no DACS user -> 403",
    unsyncedHit.status === 403,
    `status ${unsyncedHit.status}`
  );

  // Disabled account: sync (creates ACTIVE), disable via prisma, retry.
  const disabled = await mintFarmerToken(apiKey, DISABLED_EMAIL);
  await api("/api/auth/sync", { method: "POST", token: disabled.token });
  await prisma.user.update({
    where: { firebaseUid: disabled.uid },
    data: { status: "DISABLED" },
  });
  const disabledHit = await api("/api/customers/me", { token: disabled.token });
  record(
    "A-auth",
    "DISABLED account with valid token -> 403",
    disabledHit.status === 403 &&
      (disabledHit.body?.message ?? "").toLowerCase().includes("disabled"),
    `status ${disabledHit.status}: ${disabledHit.body?.message}`
  );
  const disabledWrite = await api("/api/customers/me", {
    method: "PATCH",
    token: disabled.token,
    body: { occupation: "x" },
  });
  record(
    "A-auth",
    "DISABLED account cannot write -> 403",
    disabledWrite.status === 403,
    `status ${disabledWrite.status}`
  );

  // ==================================================================
  // B. RBAC — farmer must never reach admin endpoints
  // ==================================================================
  const adminGetsForFarmer: Array<[string, string]> = [
    ["/api/customers", "customer list"],
    ["/api/users", "user management"],
    ["/api/audit-logs", "audit logs"],
    ["/api/historical/files", "historical files"],
    ["/api/analytics/dashboard", "analytics dashboard"],
    ["/api/orders", "all orders (staff)"],
    ["/api/breeders", "breeder registry"],
    ["/api/inquiries", "all inquiries (staff)"],
    ["/api/permissions", "permission matrix"],
    ["/api/forms", "forms"],
    ["/api/seminars/progress", "seminar progress overview"],
  ];
  for (const [path, label] of adminGetsForFarmer) {
    const r = await api(path, { token: farmerA.token });
    record("B-rbac", `Farmer -> ${label} -> 403`, r.status === 403, `status ${r.status}`);
  }
  const farmerCreateUser = await api("/api/users", {
    method: "POST",
    token: farmerA.token,
    body: { email: "x@x.com", role: "IT_STAFF" },
  });
  record(
    "B-rbac",
    "Farmer -> create staff user -> 403",
    farmerCreateUser.status === 403,
    `status ${farmerCreateUser.status}`
  );

  // Staff-role separations (backend guards are the boundary).
  const adminUsers = await api("/api/users", { token: adminStaff });
  record("B-rbac", "Admin-Staff -> user list -> 403 (Owner+IT only)", adminUsers.status === 403, `status ${adminUsers.status}`);
  const adminAudit = await api("/api/audit-logs", { token: adminStaff });
  record("B-rbac", "Admin-Staff -> audit logs -> 403 (Owner only)", adminAudit.status === 403, `status ${adminAudit.status}`);
  const itHistorical = await api("/api/historical/files", { token: itStaff });
  record("B-rbac", "IT-Staff -> historical files -> 403", itHistorical.status === 403, `status ${itHistorical.status}`);
  const itForms = await api("/api/forms", { token: itStaff });
  record("B-rbac", "IT-Staff -> forms -> 403", itForms.status === 403, `status ${itForms.status}`);
  const itAudit = await api("/api/audit-logs", { token: itStaff });
  record("B-rbac", "IT-Staff -> audit logs -> 403", itAudit.status === 403, `status ${itAudit.status}`);
  // Positive controls.
  const ownerUsers = await api("/api/users", { token: owner });
  record("B-rbac", "Owner -> user list -> 200 (positive)", ownerUsers.status === 200, `status ${ownerUsers.status}`);
  const adminCustomers = await api("/api/customers", { token: adminStaff });
  record("B-rbac", "Admin-Staff -> customer list -> 200 (positive)", adminCustomers.status === 200, `status ${adminCustomers.status}`);

  // Permission-matrix write guardrails.
  const itUpdatePerm = await api("/api/permissions", {
    method: "PATCH",
    token: itStaff,
    body: { updates: [{ role: "IT_STAFF", permissionModule: "Forms", allowed: true }] },
  });
  record("B-rbac", "IT-Staff -> update permission matrix -> 403", itUpdatePerm.status === 403, `status ${itUpdatePerm.status}`);

  // ==================================================================
  // C. IDOR / BOLA — Farmer B must never reach Farmer A's records
  // ==================================================================
  if (orderAId) {
    const bReadsA = await api(`/api/orders/me/${orderAId}`, { token: farmerB.token });
    record("C-idor", "Farmer B reads Farmer A's order -> 404", bReadsA.status === 404, `status ${bReadsA.status}`);

    const aReadsA = await api(`/api/orders/me/${orderAId}`, { token: farmerA.token });
    record("C-idor", "Farmer A reads own order -> 200 (positive)", aReadsA.status === 200, `status ${aReadsA.status}`);

    const bProofToA = await uploadProof(farmerB.token, orderAId, {
      paymentType: "FULL",
      amount: "1650",
      referenceNumber: "HACK-1",
    });
    record(
      "C-idor",
      "Farmer B uploads proof to A's order -> 404/403",
      bProofToA.status === 404 || bProofToA.status === 403,
      `status ${bProofToA.status}`
    );
  }
  if (inquiryAId) {
    const bReadsInq = await api(`/api/inquiries/me/${inquiryAId}`, { token: farmerB.token });
    record("C-idor", "Farmer B reads Farmer A's inquiry -> 404", bReadsInq.status === 404, `status ${bReadsInq.status}`);
  }
  // Random / nonexistent UUID.
  const randomOrder = await api(
    "/api/orders/me/00000000-0000-4000-8000-000000000000",
    { token: farmerB.token }
  );
  record("C-idor", "Nonexistent order id -> 404", randomOrder.status === 404, `status ${randomOrder.status}`);

  // ==================================================================
  // D. INPUT VALIDATION
  // ==================================================================
  // Negative quantity.
  const negQty = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_ADECTROL_ID, quantity: -5 }] },
  });
  record("D-input", "Negative quantity -> 400", negQty.status === 400, `status ${negQty.status}`);

  // Zero quantity.
  const zeroQty = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_ADECTROL_ID, quantity: 0 }] },
  });
  record("D-input", "Zero quantity -> 400", zeroQty.status === 400, `status ${zeroQty.status}`);

  // Non-integer quantity.
  const fracQty = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_ADECTROL_ID, quantity: 2.5 }] },
  });
  record("D-input", "Fractional quantity -> 400", fracQty.status === 400, `status ${fracQty.status}`);

  // Price injection inside item.
  const priceInject = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_ADECTROL_ID, quantity: 1, unitPrice: 1 }] },
  });
  record("D-input", "unitPrice injection in item -> 400", priceInject.status === 400, `status ${priceInject.status}`);

  // Total injection at top level.
  const totalInject = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", totalAmount: 1, subtotal: 1, items: [{ productId: VET_ADECTROL_ID, quantity: 1 }] },
  });
  record("D-input", "totalAmount/subtotal injection -> 400", totalInject.status === 400, `status ${totalInject.status}`);

  // Unrealistic quantity (overflow probe): 100M * 1400 far exceeds Decimal(12,2).
  const hugeQty = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_GLUTA_ID, quantity: 100000000 }] },
  });
  record(
    "D-input",
    "Unrealistic quantity (overflow) rejected cleanly (400, not 500)",
    hugeQty.status === 400,
    `status ${hugeQty.status} — ${hugeQty.body?.message ?? ""}`
  );

  // Overlong string.
  const longName = await api("/api/customers/me", {
    method: "PATCH",
    token: farmerA.token,
    body: { firstName: "A".repeat(5000) },
  });
  record("D-input", "Overlong firstName (5000 chars) -> 400", longName.status === 400, `status ${longName.status}`);

  // Malformed email.
  const badEmail = await api("/api/customers/me", {
    method: "PATCH",
    token: farmerA.token,
    body: { contactEmail: "not-an-email" },
  });
  record("D-input", "Malformed contactEmail -> 400", badEmail.status === 400, `status ${badEmail.status}`);

  // Protected field.
  const protectedField = await api("/api/customers/me", {
    method: "PATCH",
    token: farmerA.token,
    body: { customerNumber: "DAPG-99999" },
  });
  record("D-input", "Protected customerNumber write -> 400", protectedField.status === 400, `status ${protectedField.status}`);

  // Unexpected field.
  const unexpectedField = await api("/api/customers/me", {
    method: "PATCH",
    token: farmerA.token,
    body: { notAColumn: "x" },
  });
  record("D-input", "Unexpected field -> 400", unexpectedField.status === 400, `status ${unexpectedField.status}`);

  // Missing required (inquiry with no subject).
  const missingSubject = await api("/api/inquiries", {
    method: "POST",
    token: farmerA.token,
    body: { message: "no subject provided" },
  });
  record("D-input", "Inquiry missing subject -> 400", missingSubject.status === 400, `status ${missingSubject.status}`);

  // SQL-looking + XSS payload stored safely, echoed literally (no injection).
  const sqlPayload = "Robert'); DROP TABLE users;--";
  const xssPayload = "<script>alert('xss')</script>";
  const storeAttack = await api("/api/customers/me", {
    method: "PATCH",
    token: farmerA.token,
    body: { occupation: sqlPayload, facebookName: xssPayload },
  });
  const readBack = await api("/api/customers/me", { token: farmerA.token });
  const storedLiteral =
    readBack.body?.data?.occupation === sqlPayload &&
    readBack.body?.data?.facebookName === xssPayload;
  const usersTableIntact = await prisma.user.count();
  record(
    "D-input",
    "SQL/XSS payload stored literally, no injection (users table intact)",
    storeAttack.status === 200 && storedLiteral && usersTableIntact > 0,
    `stored=${storedLiteral} users=${usersTableIntact}`
  );

  // ==================================================================
  // E. PRICE INTEGRITY — server recomputes totals
  // ==================================================================
  const priceOrder = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "VETERINARY_PRODUCT", fulfillmentMethod: "PICKUP", items: [{ productId: VET_ADECTROL_ID, quantity: 3 }] },
  });
  const total = Number(priceOrder.body?.data?.totalAmount);
  record(
    "E-price",
    "Server computes total (825x3 = 2475)",
    priceOrder.status === 201 && total === 2475,
    `total=${total}`
  );

  // ==================================================================
  // F. PARENT-STOCK ELIGIBILITY BYPASS (backend must reject)
  // ==================================================================
  const psBypass = await api("/api/orders", {
    method: "POST",
    token: farmerA.token,
    body: { orderType: "PARENT_STOCK", fulfillmentMethod: "PICKUP", items: [{ productId: PS_D853_ID, quantity: 1 }] },
  });
  record(
    "F-eligibility",
    "PS order before seminars 1-3 -> 409 (backend enforces)",
    psBypass.status === 409,
    `status ${psBypass.status}: ${psBypass.body?.message ?? ""}`
  );

  // ---- Cleanup ------------------------------------------------------
  for (const e of [FARMER_A_EMAIL, FARMER_B_EMAIL, DISABLED_EMAIL, UNSYNCED_EMAIL])
    await cleanupFarmer(e);
  await cleanupAuditProducts();
  record("cleanup", "Disposable accounts and audit products removed", true);

  // ---- Summary ------------------------------------------------------
  const failed = results.filter((r) => !r.pass);
  const bySection = new Map<string, { p: number; t: number }>();
  for (const r of results) {
    const s = bySection.get(r.section) ?? { p: 0, t: 0 };
    s.t += 1;
    if (r.pass) s.p += 1;
    bySection.set(r.section, s);
  }
  console.log("\n--- Section summary ---");
  for (const [section, s] of bySection)
    console.log(`  ${section}: ${s.p}/${s.t}`);
  console.log(
    `\nRESULT: ${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` — ${failed.length} FAILED` : ""
    }\n`
  );
  if (failed.length) {
    console.log("FAILURES:");
    for (const f of failed) console.log(`  [${f.section}] ${f.name} — ${f.detail}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
