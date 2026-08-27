/**
 * DACS backend end-to-end smoke test.
 *
 * Run with the dev server already started (npm run dev), then:
 *   npx tsx scripts/test-backend.ts
 *
 * Walks the full chain: health checks -> Firebase sign-in (via a minted
 * custom token, no password needed) -> auth sync -> role checks ->
 * customer profile creation/editing -> farm CRUD with ownership and
 * primary-farm rules -> staff search/archive -> activity logs.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const TEST_FARM_NAMES = [
  "Test Poultry Farm",
  "Second Test Farm",
  "Renamed Poultry Farm",
];

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

// 1x1-pixel PNG and a minimal JPEG header — enough to pass magic-byte
// detection, tiny enough to upload instantly.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
// Minimal PDF: enough for the "%PDF" magic-byte check.
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF");

async function uploadProfileImage(
  token: string | undefined,
  buffer: Buffer,
  filename: string,
  contentType: string,
  path = "/api/customers/me/profile-image"
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: contentType }), filename);

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "PUT",
    headers,
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

async function submitProof(
  token: string | undefined,
  orderId: string,
  fields: Record<string, string>,
  file?: { buffer: Buffer; filename: string; contentType: string }
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (file) {
    form.append(
      "proof",
      new Blob([file.buffer], { type: file.contentType }),
      file.filename
    );
  }

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
  } catch (error) {
    console.warn("Could not fetch web API key automatically:", error);
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\nDACS backend smoke test against ${BASE_URL}\n`);
  await assertTestServer();

  // ---- 1. Health endpoints -------------------------------------------------
  const health = await api("/api/health");
  record(
    "GET /api/health",
    health.status === 200 && health.body?.success === true,
    health.body?.message ?? `status ${health.status}`
  );

  // The server must report the SAME test database this suite is
  // configured for (assertTestServer already enforced it; this records
  // the fact in the results).
  const dbHealth = await api("/api/health/database");
  record(
    "GET /api/health/database",
    dbHealth.status === 200 &&
      dbHealth.body?.database ===
        new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, ""),
    `${dbHealth.body?.message ?? `status ${dbHealth.status}`} (${dbHealth.body?.database})`
  );

  const fbHealth = await api("/api/health/firebase");
  record(
    "GET /api/health/firebase",
    fbHealth.status === 200,
    fbHealth.body?.message ?? `status ${fbHealth.status}`
  );

  // ---- 2. Negative authentication tests ------------------------------------
  const noToken = await api("/api/auth/test");
  record(
    "GET /api/auth/test without token -> 401",
    noToken.status === 401,
    noToken.body?.message ?? `status ${noToken.status}`
  );

  const badToken = await api("/api/auth/test", { token: "not-a-real-token" });
  record(
    "GET /api/auth/test with fake token -> 401",
    badToken.status === 401,
    badToken.body?.message ?? `status ${badToken.status}`
  );

  const unknownRoute = await api("/api/does-not-exist");
  record(
    "Unknown route -> 404",
    unknownRoute.status === 404,
    unknownRoute.body?.message ?? `status ${unknownRoute.status}`
  );

  // ---- 3. Obtain a real Firebase ID token ----------------------------------
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
    record(
      "Fetch web API key",
      false,
      "could not fetch automatically — set FIREBASE_WEB_API_KEY manually"
    );
    return finish();
  }
  record("Fetch web API key from Firebase project", true, "found");

  /*
   * The suite must run as the dedicated SYNTHETIC farmer fixture —
   * never as an arbitrary or real account. The project holds real staff
   * accounts (seed-staff-users.ts), and lemonyfroggo@gmail.com is now
   * the dev OWNER login (user directive 2026-08-22) — the suite used to
   * end runs by leaving its user as CLIENT_FARMER, which would demote
   * the Owner and break admin login.
   */
  const TEST_USER_EMAIL = "dacs.farmer.fixture@dacs-test.example";
  let testUser;
  try {
    testUser = await firebaseAuth.getUserByEmail(TEST_USER_EMAIL);
    record("Found Firebase test user", true, testUser.email ?? testUser.uid);
  } catch {
    testUser = await firebaseAuth.createUser({
      email: TEST_USER_EMAIL,
      password: "DacsTest1234!",
      displayName: "DACS Backend Test User",
    });
    record("Create Firebase test user", true, testUser.email ?? testUser.uid);
  }

  // The main test user must have a verified email — write routes now
  // require it (Requirement 1 email-verification enforcement).
  if (!testUser.emailVerified) {
    await firebaseAuth.updateUser(testUser.uid, { emailVerified: true });
    record("Marked test user's email as verified", true, testUser.email ?? "");
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
  const signInBody = (await signInResponse.json()) as { idToken?: string };
  const idToken = signInBody.idToken;

  record("Sign in to Firebase (mint ID token)", Boolean(idToken));
  if (!idToken) return finish();

  // ---- 3b. Email-verification enforcement ----------------------------------
  const UNVERIFIED_EMAIL = "unverified-test-user@dacs-test.example";
  let unverifiedUser;
  try {
    unverifiedUser = await firebaseAuth.getUserByEmail(UNVERIFIED_EMAIL);
    if (unverifiedUser.emailVerified) {
      await firebaseAuth.updateUser(unverifiedUser.uid, {
        emailVerified: false,
      });
    }
  } catch {
    unverifiedUser = await firebaseAuth.createUser({
      email: UNVERIFIED_EMAIL,
      password: "UnverifiedTest1234!",
      emailVerified: false,
    });
  }

  const unverifiedCustomToken = await firebaseAuth.createCustomToken(
    unverifiedUser.uid
  );
  const unverifiedSignIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: unverifiedCustomToken,
        returnSecureToken: true,
      }),
    }
  );
  const unverifiedToken = ((await unverifiedSignIn.json()) as any).idToken;

  const unverifiedWrite = await api("/api/customers/me", {
    method: "PATCH",
    token: unverifiedToken,
    body: { occupation: "Should Be Blocked" },
  });
  record(
    "Unverified email blocked from write actions -> 403",
    unverifiedWrite.status === 403 &&
      (unverifiedWrite.body?.message ?? "").includes("verify your email"),
    unverifiedWrite.body?.message ?? `status ${unverifiedWrite.status}`
  );

  await firebaseAuth.deleteUser(unverifiedUser.uid);
  record("Unverified test user cleaned up", true);

  // ---- 4. Authenticated flow -----------------------------------------------
  const authTest = await api("/api/auth/test", { token: idToken });
  record(
    "GET /api/auth/test with valid token -> 200",
    authTest.status === 200 && authTest.body?.success === true,
    authTest.body?.message ?? `status ${authTest.status}`
  );

  const sync = await api("/api/auth/sync", { method: "POST", token: idToken });
  record(
    "POST /api/auth/sync -> 200/201",
    (sync.status === 200 || sync.status === 201) && sync.body?.success === true,
    `${sync.body?.message ?? ""} (role: ${sync.body?.data?.role})`
  );

  const me = await api("/api/auth/me", { token: idToken });
  record(
    "GET /api/auth/me -> 200 with role + status",
    me.status === 200 &&
      Boolean(me.body?.data?.role) &&
      me.body?.data?.status === "ACTIVE",
    `role=${me.body?.data?.role}, status=${me.body?.data?.status}`
  );

  // ---- 5. Role-based authorization -----------------------------------------
  const dacsUserId: string = sync.body?.data?.id;

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const customersAsFarmer = await api("/api/customers", { token: idToken });
  record(
    "GET /api/customers as CLIENT_FARMER -> 403",
    customersAsFarmer.status === 403,
    customersAsFarmer.body?.message ?? `status ${customersAsFarmer.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const customersAsStaff = await api("/api/customers", { token: idToken });
  record(
    "GET /api/customers as ADMINISTRATIVE_STAFF -> 200",
    customersAsStaff.status === 200 && customersAsStaff.body?.success === true,
    `count=${customersAsStaff.body?.count}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored to CLIENT_FARMER", true);

  // ---- 6. Account-status protection ----------------------------------------
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { status: "SUSPENDED" },
  });

  const suspended = await api("/api/auth/me", { token: idToken });
  record(
    "GET /api/auth/me while SUSPENDED -> 403",
    suspended.status === 403,
    suspended.body?.message ?? `status ${suspended.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { status: "ACTIVE" },
  });
  record("Status restored to ACTIVE", true);

  // ---- 7. Customer profile creation ----------------------------------------
  const existingProfile = await prisma.customerProfile.findUnique({
    where: { userId: dacsUserId },
  });

  if (!existingProfile) {
    const beforeProfile = await api("/api/customers/me", { token: idToken });
    record(
      "GET /api/customers/me before creation -> 404",
      beforeProfile.status === 404,
      beforeProfile.body?.message ?? `status ${beforeProfile.status}`
    );

    const created = await api("/api/customers/me", {
      method: "POST",
      token: idToken,
      body: {
        firstName: "Test",
        middleName: "Sample",
        lastName: "Farmer",
        occupation: "Poultry Farmer",
        facebookName: "Test Farmer",
        addressLine1: "Sample Street",
        barangay: "Sample Barangay",
        cityMunicipality: "Sample City",
        province: "Sample Province",
        region: "Region IV-A",
        postalCode: "4000",
      },
    });
    record(
      "POST /api/customers/me -> 201 with DAPG number",
      created.status === 201 &&
        /^DAPG-\d{5}$/.test(created.body?.data?.customerNumber ?? ""),
      `customerNumber=${created.body?.data?.customerNumber}`
    );
  } else {
    record(
      "Customer profile already exists",
      true,
      existingProfile.customerNumber
    );
  }

  const myProfile = await api("/api/customers/me", { token: idToken });
  record(
    "GET /api/customers/me -> 200 with profile",
    myProfile.status === 200 && Boolean(myProfile.body?.data?.customerNumber),
    `customerNumber=${myProfile.body?.data?.customerNumber}`
  );
  const myProfileId: string = myProfile.body?.data?.id;
  const myCustomerNumber: string = myProfile.body?.data?.customerNumber;

  const missingName = await api("/api/customers/me", {
    method: "POST",
    token: idToken,
    body: { firstName: "OnlyFirst" },
  });
  record(
    "POST /api/customers/me without last name -> 400 or 409",
    missingName.status === 400 || missingName.status === 409,
    missingName.body?.message ?? `status ${missingName.status}`
  );

  const duplicate = await api("/api/customers/me", {
    method: "POST",
    token: idToken,
    body: { firstName: "Test", lastName: "Farmer" },
  });
  record(
    "POST /api/customers/me duplicate -> 409",
    duplicate.status === 409,
    duplicate.body?.message ?? `status ${duplicate.status}`
  );

  // ---- 8. Farm module ------------------------------------------------------
  // Remove farms left over from previous test runs so reruns stay clean.
  // Breeder rows from the previous run's 10g section reference these
  // farms (Restrict FK), so they must go first — the 10g section
  // recreates everything it needs.
  await prisma.breederCertification.deleteMany({
    where: { monitoring: { customerProfileId: myProfileId } },
  });
  await prisma.breederEligibility.deleteMany({
    where: { monitoring: { customerProfileId: myProfileId } },
  });
  await prisma.breederMonitoring.deleteMany({
    where: { customerProfileId: myProfileId },
  });
  await prisma.farm.deleteMany({
    where: {
      customerProfileId: myProfileId,
      farmName: { in: TEST_FARM_NAMES },
    },
  });

  const farmsBefore = await api("/api/farms/me", { token: idToken });
  const baselineFarmCount: number = farmsBefore.body?.count ?? 0;
  record(
    "GET /api/farms/me -> 200 with customerNumber",
    farmsBefore.status === 200 &&
      farmsBefore.body?.customerNumber === myCustomerNumber,
    `customerNumber=${farmsBefore.body?.customerNumber}, count=${baselineFarmCount}`
  );

  const farmNoName = await api("/api/farms", {
    method: "POST",
    token: idToken,
    body: { addressLine1: "Missing Name Road" },
  });
  record(
    "POST /api/farms without farmName -> 400",
    farmNoName.status === 400,
    farmNoName.body?.message ?? `status ${farmNoName.status}`
  );

  const badPrimaryType = await api("/api/farms", {
    method: "POST",
    token: idToken,
    body: { farmName: "Bad Primary Farm", isPrimary: "yes" },
  });
  record(
    "POST /api/farms with isPrimary='yes' (string) -> 400",
    badPrimaryType.status === 400,
    badPrimaryType.body?.message ?? `status ${badPrimaryType.status}`
  );

  const injectedOwnership = await api("/api/farms", {
    method: "POST",
    token: idToken,
    body: {
      farmName: "Injected Farm",
      customerProfileId: "00000000-0000-0000-0000-000000000000",
    },
  });
  record(
    "POST /api/farms with customerProfileId injection -> 400",
    injectedOwnership.status === 400 &&
      injectedOwnership.body?.field === "customerProfileId",
    injectedOwnership.body?.message ?? `status ${injectedOwnership.status}`
  );

  const farm1 = await api("/api/farms", {
    method: "POST",
    token: idToken,
    body: {
      farmName: "Test Poultry Farm",
      addressLine1: "Sample Farm Road",
      barangay: "Sample Barangay",
      cityMunicipality: "Sample City",
      province: "Sample Province",
      region: "Region IV-A",
      postalCode: "4000",
    },
  });
  const farm1Id: string = farm1.body?.data?.id;
  const expectFarm1Primary = baselineFarmCount === 0;
  record(
    "POST /api/farms -> 201",
    farm1.status === 201 &&
      (!expectFarm1Primary || farm1.body?.data?.isPrimary === true),
    `isPrimary=${farm1.body?.data?.isPrimary} (first farm auto-primary: ${expectFarm1Primary})`
  );

  const farm2 = await api("/api/farms", {
    method: "POST",
    token: idToken,
    body: { farmName: "Second Test Farm", isPrimary: true },
  });
  const farm2Id: string = farm2.body?.data?.id;
  record(
    "POST second farm with isPrimary=true -> 201 and primary",
    farm2.status === 201 && farm2.body?.data?.isPrimary === true,
    `isPrimary=${farm2.body?.data?.isPrimary}`
  );

  const farmsAfterTwo = await api("/api/farms/me", { token: idToken });
  const farm1Listed = farmsAfterTwo.body?.data?.find(
    (farm: any) => farm.id === farm1Id
  );
  record(
    "Primary flag moved off the first farm",
    farmsAfterTwo.status === 200 &&
      farm1Listed?.isPrimary === false &&
      farmsAfterTwo.body?.count === baselineFarmCount + 2,
    `count=${farmsAfterTwo.body?.count}`
  );

  const farmRename = await api(`/api/farms/${farm1Id}`, {
    method: "PATCH",
    token: idToken,
    body: { farmName: "Renamed Poultry Farm", isPrimary: true },
  });
  record(
    "PATCH /api/farms/:id rename + take primary -> 200",
    farmRename.status === 200 &&
      farmRename.body?.data?.farmName === "Renamed Poultry Farm" &&
      farmRename.body?.data?.isPrimary === true,
    farmRename.body?.message ?? `status ${farmRename.status}`
  );

  const unsetPrimary = await api(`/api/farms/${farm1Id}`, {
    method: "PATCH",
    token: idToken,
    body: { isPrimary: false },
  });
  record(
    "PATCH primary farm with isPrimary=false -> 400",
    unsetPrimary.status === 400,
    unsetPrimary.body?.message ?? `status ${unsetPrimary.status}`
  );

  // Ownership protection: create another farmer directly in the database
  // and try to modify their farm with our token.
  const strangerUser = await prisma.user.upsert({
    where: { firebaseUid: "ownership-test-uid" },
    update: {},
    create: {
      firebaseUid: "ownership-test-uid",
      email: "ownership-test@example.com",
    },
  });
  const strangerProfile = await prisma.customerProfile.upsert({
    where: { customerNumber: "DAPG-99999" },
    update: { archivedAt: null },
    create: {
      customerNumber: "DAPG-99999",
      userId: strangerUser.id,
      firstName: "Other",
      lastName: "Farmer",
      province: "Other Province",
    },
  });
  const strangerFarm = await prisma.farm.create({
    data: {
      customerProfileId: strangerProfile.id,
      farmName: "Stranger Farm",
    },
  });

  const foreignPatch = await api(`/api/farms/${strangerFarm.id}`, {
    method: "PATCH",
    token: idToken,
    body: { farmName: "Hacked Farm" },
  });
  record(
    "PATCH someone else's farm -> 404 (existence hidden)",
    foreignPatch.status === 404,
    foreignPatch.body?.message ?? `status ${foreignPatch.status}`
  );

  // ---- 8b. Farm-logo uploads -----------------------------------------------
  const logoUpload = await uploadProfileImage(
    idToken,
    TINY_PNG,
    "logo.png",
    "image/png",
    `/api/farms/${farm1Id}/logo`
  );
  const logoUrl: string = logoUpload.body?.data?.farmLogoUrl ?? "";
  record(
    "PUT farm logo with PNG -> 200 with URL",
    logoUpload.status === 200 && logoUrl.includes("/uploads/farm-logos/"),
    logoUrl || logoUpload.body?.message || `status ${logoUpload.status}`
  );

  const servedLogo = await fetch(logoUrl);
  record(
    "Uploaded farm logo is served at its URL",
    servedLogo.status === 200,
    `HTTP ${servedLogo.status}`
  );

  const foreignLogo = await uploadProfileImage(
    idToken,
    TINY_PNG,
    "logo.png",
    "image/png",
    `/api/farms/${strangerFarm.id}/logo`
  );
  record(
    "PUT logo on someone else's farm -> 404",
    foreignLogo.status === 404,
    foreignLogo.body?.message ?? `status ${foreignLogo.status}`
  );

  const badLogo = await uploadProfileImage(
    idToken,
    Buffer.from("not an image at all"),
    "virus.exe",
    "image/png",
    `/api/farms/${farm1Id}/logo`
  );
  record(
    "PUT non-image farm logo (fake mimetype) -> 400",
    badLogo.status === 400,
    badLogo.body?.message ?? `status ${badLogo.status}`
  );

  // Delete the PRIMARY farm (farm1) — the remaining farm must be
  // automatically promoted to primary.
  const farmDelete = await api(`/api/farms/${farm1Id}`, {
    method: "DELETE",
    token: idToken,
  });
  record(
    "DELETE primary farm -> 200 (archived)",
    farmDelete.status === 200,
    farmDelete.body?.message ?? `status ${farmDelete.status}`
  );

  const farmsAfterDelete = await api("/api/farms/me", { token: idToken });
  const farm2AfterDelete = farmsAfterDelete.body?.data?.find(
    (farm: any) => farm.id === farm2Id
  );
  record(
    "Archived farm hidden and remaining farm auto-promoted to primary",
    farmsAfterDelete.status === 200 &&
      farmsAfterDelete.body?.count === baselineFarmCount + 1 &&
      (baselineFarmCount > 0 || farm2AfterDelete?.isPrimary === true),
    `count=${farmsAfterDelete.body?.count}, secondFarm.isPrimary=${farm2AfterDelete?.isPrimary}`
  );

  const patchArchivedFarm = await api(`/api/farms/${farm1Id}`, {
    method: "PATCH",
    token: idToken,
    body: { farmName: "Ghost Farm" },
  });
  record(
    "PATCH archived farm -> 404",
    patchArchivedFarm.status === 404,
    patchArchivedFarm.body?.message ?? `status ${patchArchivedFarm.status}`
  );

  const malformedFarmId = await api("/api/farms/not-a-uuid", {
    method: "PATCH",
    token: idToken,
    body: { farmName: "Whatever" },
  });
  record(
    "PATCH /api/farms/not-a-uuid -> 400 (malformed ID)",
    malformedFarmId.status === 400,
    malformedFarmId.body?.message ?? `status ${malformedFarmId.status}`
  );

  // ---- 9. Customer profile editing -----------------------------------------
  const updateMe = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { occupation: "Layer Farmer", phoneNumber: "0917-123-4567" },
  });
  record(
    "PATCH /api/customers/me -> 200",
    updateMe.status === 200 &&
      updateMe.body?.data?.occupation === "Layer Farmer",
    `occupation=${updateMe.body?.data?.occupation}`
  );

  const systemFieldAttempt = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { customerNumber: "DAPG-77777", occupation: "Poultry Farmer" },
  });
  record(
    "PATCH with system-managed field -> 400 naming the field",
    systemFieldAttempt.status === 400 &&
      (systemFieldAttempt.body?.protectedFields ?? []).includes(
        "customerNumber"
      ),
    `${systemFieldAttempt.body?.message ?? ""} [${(
      systemFieldAttempt.body?.protectedFields ?? []
    ).join(", ")}]`
  );

  const badPhone = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { phoneNumber: "not-a-phone" },
  });
  record(
    "PATCH with invalid phone -> 400",
    badPhone.status === 400,
    badPhone.body?.message ?? `status ${badPhone.status}`
  );

  const emptyUpdate = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: {},
  });
  record(
    "PATCH with no fields -> 400",
    emptyUpdate.status === 400,
    emptyUpdate.body?.message ?? `status ${emptyUpdate.status}`
  );

  const clearField = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { facebookName: "" },
  });
  record(
    "PATCH with empty string clears the field",
    clearField.status === 200 && clearField.body?.data?.facebookName === null,
    `facebookName=${JSON.stringify(clearField.body?.data?.facebookName)}`
  );

  const emptyFirstName = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { firstName: "" },
  });
  record(
    "PATCH with empty firstName -> 400 (names cannot be cleared)",
    emptyFirstName.status === 400,
    emptyFirstName.body?.message ?? `status ${emptyFirstName.status}`
  );

  const unexpectedField = await api("/api/customers/me", {
    method: "PATCH",
    token: idToken,
    body: { occupation: "Farmer", randomSecretField: "Hello" },
  });
  record(
    "PATCH with unexpected field -> 400 naming the field",
    unexpectedField.status === 400 &&
      unexpectedField.body?.field === "randomSecretField",
    unexpectedField.body?.message ?? `status ${unexpectedField.status}`
  );

  // ---- 9b. Profile-image uploads -------------------------------------------
  const pngUpload = await uploadProfileImage(
    idToken,
    TINY_PNG,
    "avatar.png",
    "image/png"
  );
  const pngUrl: string = pngUpload.body?.data?.profileImageUrl ?? "";
  record(
    "PUT profile-image with PNG -> 200 with URL",
    pngUpload.status === 200 && pngUrl.includes("/uploads/profile-images/"),
    pngUrl || pngUpload.body?.message || `status ${pngUpload.status}`
  );

  const profileWithImage = await api("/api/customers/me", { token: idToken });
  record(
    "GET /api/customers/me returns profileImageUrl",
    profileWithImage.status === 200 &&
      profileWithImage.body?.data?.profileImageUrl === pngUrl,
    `profileImageUrl=${profileWithImage.body?.data?.profileImageUrl}`
  );

  const servedImage = await fetch(pngUrl);
  record(
    "Uploaded image is served at its URL",
    servedImage.status === 200,
    `HTTP ${servedImage.status}`
  );

  const jpegReplace = await uploadProfileImage(
    idToken,
    TINY_JPEG,
    "avatar.jpg",
    "image/jpeg"
  );
  const jpegUrl: string = jpegReplace.body?.data?.profileImageUrl ?? "";
  record(
    "Replacing profile image -> new URL",
    jpegReplace.status === 200 && jpegUrl !== "" && jpegUrl !== pngUrl,
    jpegUrl || `status ${jpegReplace.status}`
  );

  const oldImage = await fetch(pngUrl);
  record(
    "Old profile image file was deleted",
    oldImage.status === 404,
    `HTTP ${oldImage.status}`
  );

  const badFileUpload = await uploadProfileImage(
    idToken,
    Buffer.from("this is definitely not an image"),
    "notes.txt",
    "text/plain"
  );
  record(
    "Uploading a non-image file -> 400",
    badFileUpload.status === 400,
    badFileUpload.body?.message ?? `status ${badFileUpload.status}`
  );

  const noAuthUpload = await uploadProfileImage(
    undefined,
    TINY_PNG,
    "avatar.png",
    "image/png"
  );
  record(
    "Upload without token -> 401",
    noAuthUpload.status === 401,
    noAuthUpload.body?.message ?? `status ${noAuthUpload.status}`
  );

  // ---- 10. Staff endpoints: view, search, archive ---------------------------
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const singleCustomer = await api(`/api/customers/${myProfileId}`, {
    token: idToken,
  });
  record(
    "GET /api/customers/:id as staff -> 200",
    singleCustomer.status === 200 &&
      singleCustomer.body?.data?.customerNumber === myCustomerNumber,
    `customerNumber=${singleCustomer.body?.data?.customerNumber}, farms=${singleCustomer.body?.data?.farms?.length}`
  );

  const unknownCustomer = await api(
    "/api/customers/00000000-0000-0000-0000-000000000000",
    { token: idToken }
  );
  record(
    "GET /api/customers/:id with unknown id -> 404",
    unknownCustomer.status === 404,
    unknownCustomer.body?.message ?? `status ${unknownCustomer.status}`
  );

  const malformedCustomerId = await api("/api/customers/hello", {
    token: idToken,
  });
  record(
    "GET /api/customers/hello -> 400 (malformed ID)",
    malformedCustomerId.status === 400,
    malformedCustomerId.body?.message ?? `status ${malformedCustomerId.status}`
  );

  const searchHit = await api("/api/customers?search=farmer", {
    token: idToken,
  });
  record(
    "GET /api/customers?search=farmer finds matches + echoes filters",
    searchHit.status === 200 &&
      (searchHit.body?.count ?? 0) >= 1 &&
      searchHit.body?.filters?.search === "farmer",
    `count=${searchHit.body?.count}, filters.search=${searchHit.body?.filters?.search}`
  );

  const farmNameSearch = await api(
    `/api/customers?search=${encodeURIComponent("Second Test")}`,
    { token: idToken }
  );
  record(
    "Search by farm name finds the owning customer",
    farmNameSearch.status === 200 && (farmNameSearch.body?.count ?? 0) >= 1,
    `count=${farmNameSearch.body?.count}`
  );

  const searchMiss = await api("/api/customers?province=Nowhere", {
    token: idToken,
  });
  record(
    "GET /api/customers?province=Nowhere -> 0 results",
    searchMiss.status === 200 && searchMiss.body?.count === 0,
    `count=${searchMiss.body?.count}`
  );

  const archiveCustomerCall = await api(
    `/api/customers/${strangerProfile.id}`,
    { method: "DELETE", token: idToken }
  );
  record(
    "DELETE /api/customers/:id (archive) as staff -> 200",
    archiveCustomerCall.status === 200,
    archiveCustomerCall.body?.message ?? `status ${archiveCustomerCall.status}`
  );

  const searchArchived = await api("/api/customers?search=DAPG-99999", {
    token: idToken,
  });
  record(
    "Archived customer hidden from list",
    searchArchived.status === 200 && searchArchived.body?.count === 0,
    `count=${searchArchived.body?.count}`
  );

  const archivedFetch = await api(`/api/customers/${strangerProfile.id}`, {
    token: idToken,
  });
  record(
    "GET archived customer by id -> 404",
    archivedFetch.status === 404,
    archivedFetch.body?.message ?? `status ${archivedFetch.status}`
  );

  const secondArchive = await api(`/api/customers/${strangerProfile.id}`, {
    method: "DELETE",
    token: idToken,
  });
  record(
    "Second archive attempt -> 404",
    secondArchive.status === 404,
    secondArchive.body?.message ?? `status ${secondArchive.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored to CLIENT_FARMER", true);

  // ---- 10b. User management (Requirement 1 + 2) ------------------------------
  const tempUser = await prisma.user.upsert({
    where: { firebaseUid: "TEMP-USER-MANAGEMENT-001" },
    update: { role: "CLIENT_FARMER", status: "ACTIVE" },
    create: {
      firebaseUid: "TEMP-USER-MANAGEMENT-001",
      email: "temp-user-management@example.com",
    },
  });

  const farmerUsersList = await api("/api/users", { token: idToken });
  record(
    "GET /api/users as CLIENT_FARMER -> 403",
    farmerUsersList.status === 403,
    farmerUsersList.body?.message ?? `status ${farmerUsersList.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "OWNER_EXECUTIVE" },
  });

  const usersList = await api("/api/users", { token: idToken });
  record(
    "GET /api/users as OWNER_EXECUTIVE -> 200 (count >= 2)",
    usersList.status === 200 && (usersList.body?.count ?? 0) >= 2,
    `count=${usersList.body?.count}`
  );

  const oneUser = await api(`/api/users/${tempUser.id}`, { token: idToken });
  record(
    "GET /api/users/:id -> 200",
    oneUser.status === 200 &&
      oneUser.body?.data?.email === "temp-user-management@example.com",
    `email=${oneUser.body?.data?.email}, role=${oneUser.body?.data?.role}`
  );

  const badUserId = await api("/api/users/hello", { token: idToken });
  record(
    "GET /api/users/hello -> 400 (malformed ID)",
    badUserId.status === 400,
    badUserId.body?.message ?? `status ${badUserId.status}`
  );

  const roleChange = await api(`/api/users/${tempUser.id}/role`, {
    method: "PATCH",
    token: idToken,
    body: { role: "ADMINISTRATIVE_STAFF" },
  });
  record(
    "PATCH /api/users/:id/role -> 200",
    roleChange.status === 200 &&
      roleChange.body?.data?.role === "ADMINISTRATIVE_STAFF",
    `role=${roleChange.body?.data?.role}`
  );

  const sameRole = await api(`/api/users/${tempUser.id}/role`, {
    method: "PATCH",
    token: idToken,
    body: { role: "ADMINISTRATIVE_STAFF" },
  });
  record(
    "PATCH same role again -> 409",
    sameRole.status === 409,
    sameRole.body?.message ?? `status ${sameRole.status}`
  );

  const invalidRole = await api(`/api/users/${tempUser.id}/role`, {
    method: "PATCH",
    token: idToken,
    body: { role: "SUPER_ADMIN" },
  });
  record(
    "PATCH invented role SUPER_ADMIN -> 400",
    invalidRole.status === 400,
    invalidRole.body?.message ?? `status ${invalidRole.status}`
  );

  const suspendUser = await api(`/api/users/${tempUser.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "SUSPENDED" },
  });
  record(
    "PATCH status SUSPENDED -> 200",
    suspendUser.status === 200 && suspendUser.body?.data?.status === "SUSPENDED",
    `status=${suspendUser.body?.data?.status}`
  );

  const reactivateUser = await api(`/api/users/${tempUser.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "ACTIVE" },
  });
  record(
    "PATCH status back to ACTIVE -> 200",
    reactivateUser.status === 200 &&
      reactivateUser.body?.data?.status === "ACTIVE",
    `status=${reactivateUser.body?.data?.status}`
  );

  const disableUser = await api(`/api/users/${tempUser.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "DISABLED" },
  });
  record(
    "PATCH status DISABLED -> 200",
    disableUser.status === 200 && disableUser.body?.data?.status === "DISABLED",
    `status=${disableUser.body?.data?.status}`
  );

  await api(`/api/users/${tempUser.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "ACTIVE" },
  });

  const selfRole = await api(`/api/users/${dacsUserId}/role`, {
    method: "PATCH",
    token: idToken,
    body: { role: "CLIENT_FARMER" },
  });
  record(
    "PATCH own role -> 403 (self-change blocked)",
    selfRole.status === 403,
    selfRole.body?.message ?? `status ${selfRole.status}`
  );

  const selfStatus = await api(`/api/users/${dacsUserId}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "DISABLED" },
  });
  record(
    "PATCH own status -> 403 (self-disable blocked)",
    selfStatus.status === 403,
    selfStatus.body?.message ?? `status ${selfStatus.status}`
  );

  // IT_STAFF may not modify Owners/IT staff, and may not change roles at all.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "IT_STAFF" },
  });
  await prisma.user.update({
    where: { id: tempUser.id },
    data: { role: "OWNER_EXECUTIVE" },
  });

  const protectedTarget = await api(`/api/users/${tempUser.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "SUSPENDED" },
  });
  record(
    "IT_STAFF suspending an Owner -> 403 (protected target)",
    protectedTarget.status === 403,
    protectedTarget.body?.message ?? `status ${protectedTarget.status}`
  );

  const itRoleChange = await api(`/api/users/${tempUser.id}/role`, {
    method: "PATCH",
    token: idToken,
    body: { role: "CLIENT_FARMER" },
  });
  record(
    "IT_STAFF changing a role -> 403 (Owner-only)",
    itRoleChange.status === 403,
    itRoleChange.body?.message ?? `status ${itRoleChange.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored to CLIENT_FARMER after user-management tests", true);

  const userMgmtLogs = await prisma.activityLog.findMany({
    where: { module: "USERS" },
    select: { action: true },
  });
  const requiredUserActions = [
    "ROLE_CHANGED",
    "ACCOUNT_SUSPENDED",
    "ACCOUNT_REACTIVATED",
    "ACCOUNT_DISABLED",
  ];
  const missingUserActions = requiredUserActions.filter(
    (action) => !userMgmtLogs.some((log) => log.action === action)
  );
  record(
    "USERS activity logs recorded (role + status changes)",
    missingUserActions.length === 0,
    missingUserActions.length
      ? `missing: ${missingUserActions.join(", ")}`
      : `${userMgmtLogs.length} USERS entries`
  );

  await prisma.user.delete({ where: { id: tempUser.id } });
  record("User-management fixtures cleaned up", true);

  // ---- 10c. Products (Requirement 4) -----------------------------------------
  // Previous runs' breeder records must go before orders (monitoring
  // Restricts order deletion; certifications Restrict monitoring), then
  // payments and orders before the products they reference.
  // Notifications from the previous run (and the 10k staff fixture, if
  // a crash left it behind) go first — they have no FK dependents.
  await prisma.notification.deleteMany({ where: { userId: dacsUserId } });
  await prisma.notificationPreference.deleteMany({
    where: { userId: dacsUserId },
  });
  await prisma.user.deleteMany({
    where: { email: "notification-staff-fixture@dacs-test.example" },
  });

  await prisma.breederCertification.deleteMany({
    where: { monitoring: { customerProfile: { userId: dacsUserId } } },
  });
  await prisma.breederMonitoring.deleteMany({
    where: { customerProfile: { userId: dacsUserId } },
  });
  await prisma.payment.deleteMany({
    where: { customerProfile: { userId: dacsUserId } },
  });
  await prisma.order.deleteMany({
    where: { customerProfile: { userId: dacsUserId } },
  });
  // Seminar fixtures too: stale completed enrollments would wrongly
  // unlock Parent Stock in the order tests below.
  await prisma.certificateRequest.deleteMany({
    where: { customerProfile: { userId: dacsUserId } },
  });
  await prisma.seminarEnrollment.deleteMany({
    where: { module: { moduleNumber: { in: [1, 2, 3] } } },
  });
  await prisma.seminarModule.deleteMany({
    where: { moduleNumber: { in: [1, 2, 3] } },
  });

  const TEST_PRODUCT_CODES = ["VET-ADECTROL-1L", "PS-DOM-BROWN", "F1-DOM-BROWN"];
  await prisma.product.deleteMany({
    where: { productCode: { in: TEST_PRODUCT_CODES } },
  });

  const farmerProductList = await api("/api/products", { token: idToken });
  record(
    "GET /api/products as farmer -> 200",
    farmerProductList.status === 200,
    `count=${farmerProductList.body?.count}`
  );

  const farmerCreateProduct = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: {
      productCode: "HACK-1",
      name: "Farmer Product",
      category: "F1",
      unitPrice: 1,
    },
  });
  record(
    "POST /api/products as farmer -> 403",
    farmerCreateProduct.status === 403,
    farmerCreateProduct.body?.message ?? `status ${farmerCreateProduct.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const adectrol = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: {
      productCode: "VET-ADECTROL-1L",
      name: "ADECTROL Poultry Tonic 1L",
      category: "VETERINARY_PRODUCT",
      description: "Veterinary poultry supplement",
      unit: "bottle",
      unitPrice: 500,
    },
  });
  const adectrolId: string = adectrol.body?.data?.id;
  record(
    "POST veterinary product -> 201 active",
    adectrol.status === 201 &&
      adectrol.body?.data?.isActive === true &&
      Number(adectrol.body?.data?.unitPrice) === 500,
    `${adectrol.body?.data?.productCode} @ ${adectrol.body?.data?.unitPrice}`
  );

  const parentStock = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: {
      productCode: "PS-DOM-BROWN",
      name: "Dominant Brown Parent Stock",
      category: "PARENT_STOCK",
      unit: "bird",
      unitPrice: 1000,
    },
  });
  const f1Product = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: {
      productCode: "F1-DOM-BROWN",
      name: "Dominant Brown F1",
      category: "F1",
      unit: "bird",
      unitPrice: 300,
    },
  });
  record(
    "POST Parent Stock + F1 products -> 201",
    parentStock.status === 201 && f1Product.status === 201,
    `${parentStock.body?.data?.productCode}, ${f1Product.body?.data?.productCode}`
  );

  const duplicateCode = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: {
      productCode: "VET-ADECTROL-1L",
      name: "Duplicate",
      category: "VETERINARY_PRODUCT",
      unitPrice: 1,
    },
  });
  record(
    "POST duplicate product code -> 409",
    duplicateCode.status === 409,
    duplicateCode.body?.message ?? `status ${duplicateCode.status}`
  );

  const badCategory = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: { productCode: "X-1", name: "X", category: "TOYS", unitPrice: 1 },
  });
  record(
    "POST invalid category -> 400",
    badCategory.status === 400,
    badCategory.body?.message ?? `status ${badCategory.status}`
  );

  const negativePrice = await api("/api/products", {
    method: "POST",
    token: idToken,
    body: { productCode: "X-2", name: "X", category: "F1", unitPrice: -5 },
  });
  record(
    "POST negative unit price -> 400",
    negativePrice.status === 400,
    negativePrice.body?.message ?? `status ${negativePrice.status}`
  );

  const productList = await api("/api/products", { token: idToken });
  record(
    "GET /api/products -> count >= 3",
    productList.status === 200 && (productList.body?.count ?? 0) >= 3,
    `count=${productList.body?.count}`
  );

  const priceUpdate = await api(`/api/products/${adectrolId}`, {
    method: "PATCH",
    token: idToken,
    body: { unitPrice: 525 },
  });
  record(
    "PATCH product price -> 200 (525)",
    priceUpdate.status === 200 &&
      Number(priceUpdate.body?.data?.unitPrice) === 525,
    `unitPrice=${priceUpdate.body?.data?.unitPrice}`
  );

  const oneProduct = await api(`/api/products/${adectrolId}`, {
    token: idToken,
  });
  record(
    "GET /api/products/:id -> 200",
    oneProduct.status === 200 &&
      oneProduct.body?.data?.productCode === "VET-ADECTROL-1L",
    `${oneProduct.body?.data?.productCode}`
  );

  const badProductId = await api("/api/products/hello", { token: idToken });
  record(
    "GET /api/products/hello -> 400 (malformed ID)",
    badProductId.status === 400,
    badProductId.body?.message ?? `status ${badProductId.status}`
  );

  const deactivated = await api(`/api/products/${adectrolId}`, {
    method: "DELETE",
    token: idToken,
  });
  record(
    "DELETE (deactivate) product -> 200",
    deactivated.status === 200 && deactivated.body?.data?.isActive === false,
    `isActive=${deactivated.body?.data?.isActive}`
  );

  const listAfterDeactivate = await api("/api/products", { token: idToken });
  const stillListed = (listAfterDeactivate.body?.data ?? []).some(
    (product: any) => product.id === adectrolId
  );
  record(
    "Deactivated product hidden from list",
    listAfterDeactivate.status === 200 && !stillListed,
    `count=${listAfterDeactivate.body?.count}`
  );

  // Reactivate so the catalog keeps all three products for the orders sprint.
  await api(`/api/products/${adectrolId}`, {
    method: "PATCH",
    token: idToken,
    body: { isActive: true },
  });

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after product tests", true);

  const productLogs = await prisma.activityLog.findMany({
    where: { module: "PRODUCTS" },
    select: { action: true },
  });
  const requiredProductActions = [
    "PRODUCT_CREATED",
    "PRODUCT_UPDATED",
    "PRODUCT_DEACTIVATED",
  ];
  const missingProductActions = requiredProductActions.filter(
    (action) => !productLogs.some((log) => log.action === action)
  );
  record(
    "PRODUCTS activity logs recorded",
    missingProductActions.length === 0,
    missingProductActions.length
      ? `missing: ${missingProductActions.join(", ")}`
      : `${productLogs.length} PRODUCTS entries`
  );

  // ---- 10d. Orders (Requirement 4) ------------------------------------------
  // (Older orders/payments were already cleaned at the top of 10c.)
  const f1ProductId: string = f1Product.body?.data?.id;
  const parentStockId: string = parentStock.body?.data?.id;

  const orderSubmit = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      dateNeeded: "2026-09-15",
      receiverName: "Test Farmer",
      receiverContact: "09123456789",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      instructions: "Backend order test",
      items: [{ productId: f1ProductId, quantity: 10 }],
    },
  });
  const order = orderSubmit.body?.data;
  record(
    "POST /api/orders (F1 x10) -> 201 PENDING with OQ-F1-YYYY-NNN number",
    orderSubmit.status === 201 &&
      /^OQ-F1-\d{4}-\d{3,}$/.test(order?.orderNumber ?? "") &&
      order?.status === "PENDING",
    `${order?.orderNumber} ${order?.status}`
  );

  record(
    "Order totals calculated server-side (10 x 300 = 3000)",
    Number(order?.subtotal) === 3000 &&
      Number(order?.feeTotal) === 0 &&
      Number(order?.totalAmount) === 3000,
    `subtotal=${order?.subtotal} fee=${order?.feeTotal} total=${order?.totalAmount}`
  );

  const orderItem = order?.items?.[0];
  record(
    "Order item stores price snapshots",
    order?.items?.length === 1 &&
      orderItem?.productCodeSnapshot === "F1-DOM-BROWN" &&
      orderItem?.productNameSnapshot === "Dominant Brown F1" &&
      Number(orderItem?.unitPriceSnapshot) === 300 &&
      orderItem?.quantity === 10 &&
      Number(orderItem?.lineTotal) === 3000,
    `${orderItem?.productCodeSnapshot} @ ${orderItem?.unitPriceSnapshot} x ${orderItem?.quantity}`
  );

  const initialHistory = order?.statusHistory?.[0];
  record(
    "Initial status history row (null -> PENDING)",
    order?.statusHistory?.length === 1 &&
      initialHistory?.fromStatus === null &&
      initialHistory?.toStatus === "PENDING" &&
      initialHistory?.notes === "Order submitted.",
    `${initialHistory?.fromStatus} -> ${initialHistory?.toStatus}`
  );

  const myOrders = await api("/api/orders/me", { token: idToken });
  record(
    "GET /api/orders/me -> 200 with customerNumber",
    myOrders.status === 200 &&
      myOrders.body?.count >= 1 &&
      typeof myOrders.body?.customerNumber === "string",
    `count=${myOrders.body?.count} ${myOrders.body?.customerNumber}`
  );

  const myOrder = await api(`/api/orders/me/${order?.id}`, { token: idToken });
  record(
    "GET /api/orders/me/:orderId -> 200",
    myOrder.status === 200 &&
      myOrder.body?.data?.orderNumber === order?.orderNumber,
    `${myOrder.body?.data?.orderNumber}`
  );

  const zeroQuantity = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      items: [{ productId: f1ProductId, quantity: 0 }],
    },
  });
  record(
    "POST order with quantity 0 -> 400",
    zeroQuantity.status === 400,
    zeroQuantity.body?.message ?? `status ${zeroQuantity.status}`
  );

  const priceInjection = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      items: [{ productId: f1ProductId, quantity: 10, unitPrice: 1 }],
    },
  });
  record(
    "POST order with injected unitPrice -> 400 (field rejected)",
    priceInjection.status === 400 &&
      (priceInjection.body?.message ?? "").includes("unitPrice"),
    priceInjection.body?.message ?? `status ${priceInjection.status}`
  );

  const categoryMismatch = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      items: [{ productId: adectrolId, quantity: 2 }],
    },
  });
  record(
    "POST F1 order containing veterinary product -> 400 (mismatch)",
    categoryMismatch.status === 400,
    categoryMismatch.body?.message ?? `status ${categoryMismatch.status}`
  );

  const parentStockOrder = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "PARENT_STOCK",
      items: [{ productId: parentStockId, quantity: 10 }],
    },
  });
  record(
    "POST Parent Stock order -> 409 (seminar prerequisite gate)",
    parentStockOrder.status === 409,
    parentStockOrder.body?.message ?? `status ${parentStockOrder.status}`
  );

  const ghostProduct = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      items: [
        { productId: "00000000-0000-0000-0000-000000000000", quantity: 1 },
      ],
    },
  });
  record(
    "POST order with nonexistent product -> 400",
    ghostProduct.status === 400,
    ghostProduct.body?.message ?? `status ${ghostProduct.status}`
  );

  const farmerQueue = await api("/api/orders", { token: idToken });
  record(
    "GET /api/orders as farmer -> 403 (staff only)",
    farmerQueue.status === 403,
    farmerQueue.body?.message ?? `status ${farmerQueue.status}`
  );

  const farmerStatusChange = await api(`/api/orders/${order?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "APPROVED" },
  });
  record(
    "PATCH order status as farmer -> 403",
    farmerStatusChange.status === 403,
    farmerStatusChange.body?.message ?? `status ${farmerStatusChange.status}`
  );

  const foreignOrder = await api(
    "/api/orders/me/00000000-0000-0000-0000-000000000000",
    { token: idToken }
  );
  record(
    "GET /api/orders/me/:unknownId -> 404 (existence hidden)",
    foreignOrder.status === 404,
    foreignOrder.body?.message ?? `status ${foreignOrder.status}`
  );

  // A second order (veterinary) to exercise sequential numbering and the
  // rejection path, submitted while still CLIENT_FARMER.
  const orderSubmit2 = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "VETERINARY_PRODUCT",
      fulfillmentMethod: "LBC_BRANCH",
      pickupBranch: "LBC Tagbilaran",
      items: [{ productId: adectrolId, quantity: 2 }],
    },
  });
  const order2 = orderSubmit2.body?.data;
  record(
    "VET order starts its own OQ-VET sequence (525 x 2 = 1050)",
    orderSubmit2.status === 201 &&
      /^OQ-VET-\d{4}-\d{3,}$/.test(order2?.orderNumber ?? "") &&
      Number(order2?.totalAmount) === 1050,
    `${order?.orderNumber} then ${order2?.orderNumber}, total=${order2?.totalAmount}`
  );

  // A third F1 order proves the sequence increments within one
  // type+year scope (the VET order in between must not consume an F1
  // number).
  const secondF1Submit = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: f1ProductId, quantity: 1 }],
    },
  });
  const secondF1Order = secondF1Submit.body?.data;
  const orderTail = (value: string | undefined) =>
    Number((value ?? "").split("-").at(-1));
  record(
    "Second F1 order numbered sequentially within the F1 scope",
    secondF1Submit.status === 201 &&
      (secondF1Order?.orderNumber ?? "").startsWith(
        (order?.orderNumber ?? "").slice(0, -3)
      ) &&
      orderTail(secondF1Order?.orderNumber) === orderTail(order?.orderNumber) + 1,
    `${order?.orderNumber} then ${secondF1Order?.orderNumber}`
  );

  // 14-day auto-cancel sweep: an unpaid PENDING order past the deadline
  // is cancelled by the next order read; fresh unpaid orders survive.
  const staleSubmit = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: f1ProductId, quantity: 1 }],
    },
  });
  const staleOrder = staleSubmit.body?.data;
  const staleDeadlineMs = new Date(staleOrder?.paymentDeadlineAt ?? 0).getTime();
  const expectedDeadlineMs =
    new Date(staleOrder?.createdAt ?? 0).getTime() + 14 * 24 * 60 * 60 * 1000;
  record(
    "New order stores its own paymentDeadlineAt = checkout + 14 days",
    typeof staleOrder?.paymentDeadlineAt === "string" &&
      Math.abs(staleDeadlineMs - expectedDeadlineMs) < 60 * 1000,
    `deadline=${staleOrder?.paymentDeadlineAt}`
  );
  // Time-travel the STORED deadline (what the sweep enforces) along with
  // createdAt so the order reads as 15 days old.
  await prisma.order.update({
    where: { id: staleOrder?.id ?? "" },
    data: {
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      paymentDeadlineAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
  });
  const sweptList = await api("/api/orders/me", { token: idToken });
  const sweptRows = sweptList.body?.data ?? [];
  const sweptStale = sweptRows.find((row: any) => row.id === staleOrder?.id);
  const sweptFresh = sweptRows.find(
    (row: any) => row.id === secondF1Order?.id
  );
  record(
    "Unpaid PENDING order older than 14 days -> auto-CANCELLED on read",
    sweptStale?.status === "CANCELLED" && sweptFresh?.status === "PENDING",
    `stale=${sweptStale?.status} fresh=${sweptFresh?.status}`
  );
  const autoCancelHistory = await prisma.orderStatusHistory.findFirst({
    where: { orderId: staleOrder?.id ?? "", toStatus: "CANCELLED" },
  });
  record(
    "Auto-cancel history row: system actor + deadline note",
    autoCancelHistory !== null &&
      autoCancelHistory?.changedByUserId === null &&
      (autoCancelHistory?.notes ?? "").startsWith("Automatically cancelled"),
    autoCancelHistory?.notes ?? "no history row"
  );
  const autoCancelNotification = await prisma.notification.findFirst({
    where: { type: "ORDER_AUTO_CANCELLED", recordId: staleOrder?.id ?? "" },
  });
  record(
    "Auto-cancel notifies staff: order number + no-payment reason",
    autoCancelNotification !== null &&
      (autoCancelNotification?.message ?? "").includes(
        staleOrder?.orderNumber ?? "?"
      ) &&
      (autoCancelNotification?.message ?? "").includes(
        "no payment was recorded within 14 days"
      ),
    autoCancelNotification?.message ?? "no notification row"
  );

  // Staff side: flip to ADMINISTRATIVE_STAFF for queue + status changes.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const staffQueue = await api("/api/orders", { token: idToken });
  const queuedOrder = (staffQueue.body?.data ?? []).find(
    (entry: any) => entry.id === order?.id
  );
  record(
    "GET /api/orders as staff -> 200 with customer info",
    staffQueue.status === 200 &&
      queuedOrder?.customerProfile?.customerNumber !== undefined,
    `count=${staffQueue.body?.count} customer=${queuedOrder?.customerProfile?.customerNumber}`
  );

  const staffOrderView = await api(`/api/orders/${order?.id}`, {
    token: idToken,
  });
  record(
    "GET /api/orders/:orderId as staff -> 200",
    staffOrderView.status === 200 &&
      staffOrderView.body?.data?.customerProfile?.user?.email !== undefined,
    `${staffOrderView.body?.data?.orderNumber}`
  );

  const approve = await api(`/api/orders/${order?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "APPROVED", notes: "Order details reviewed and approved." },
  });
  const approveHistory = approve.body?.data?.statusHistory ?? [];
  record(
    "PATCH status PENDING -> APPROVED with history",
    approve.status === 200 &&
      approve.body?.data?.status === "APPROVED" &&
      approveHistory.length === 2 &&
      approveHistory[1]?.fromStatus === "PENDING" &&
      approveHistory[1]?.toStatus === "APPROVED",
    `history=${approveHistory.length} entries`
  );

  const invalidTransition = await api(`/api/orders/${order?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "DELIVERED" },
  });
  record(
    "PATCH APPROVED -> DELIVERED -> 409 (invalid transition)",
    invalidTransition.status === 409,
    invalidTransition.body?.message ?? `status ${invalidTransition.status}`
  );

  // Payment schedule: the agreed split and both due dates are per-order
  // data set by staff (mockups show 30/70 and 50/50 splits).
  const scheduleSet = await api(`/api/orders/${order?.id}/payment-schedule`, {
    method: "PATCH",
    token: idToken,
    body: {
      depositPercent: 30,
      depositDueDate: "2026-08-27",
      balanceDueDate: "2026-09-07",
    },
  });
  record(
    "PATCH payment-schedule (30% deposit) -> 200 with stored dates",
    scheduleSet.status === 200 &&
      scheduleSet.body?.data?.depositPercent === 30 &&
      String(scheduleSet.body?.data?.depositDueDate).startsWith("2026-08-27") &&
      String(scheduleSet.body?.data?.balanceDueDate).startsWith("2026-09-07"),
    `deposit=${scheduleSet.body?.data?.depositPercent}% due ${scheduleSet.body?.data?.depositDueDate}`
  );

  const scheduleBadPercent = await api(
    `/api/orders/${order?.id}/payment-schedule`,
    {
      method: "PATCH",
      token: idToken,
      body: {
        depositPercent: 150,
        depositDueDate: "2026-08-27",
        balanceDueDate: "2026-09-07",
      },
    }
  );
  record(
    "PATCH payment-schedule with 150% deposit -> 400",
    scheduleBadPercent.status === 400,
    scheduleBadPercent.body?.message ?? `status ${scheduleBadPercent.status}`
  );

  const scheduleBadDates = await api(
    `/api/orders/${order?.id}/payment-schedule`,
    {
      method: "PATCH",
      token: idToken,
      body: {
        depositPercent: 50,
        depositDueDate: "2026-09-07",
        balanceDueDate: "2026-08-27",
      },
    }
  );
  record(
    "PATCH payment-schedule with balance before deposit -> 400",
    scheduleBadDates.status === 400,
    scheduleBadDates.body?.message ?? `status ${scheduleBadDates.status}`
  );

  const reject = await api(`/api/orders/${order2?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "REJECTED", notes: "Rejected during automated testing." },
  });
  record(
    "PATCH status PENDING -> REJECTED",
    reject.status === 200 && reject.body?.data?.status === "REJECTED",
    `${reject.body?.data?.orderNumber} -> ${reject.body?.data?.status}`
  );

  const ghostStatusChange = await api(
    "/api/orders/00000000-0000-0000-0000-000000000000/status",
    { method: "PATCH", token: idToken, body: { status: "APPROVED" } }
  );
  record(
    "PATCH status on unknown order -> 404",
    ghostStatusChange.status === 404,
    ghostStatusChange.body?.message ?? `status ${ghostStatusChange.status}`
  );

  const malformedOrderId = await api("/api/orders/hello", { token: idToken });
  record(
    "GET /api/orders/hello -> 400 (malformed ID)",
    malformedOrderId.status === 400,
    malformedOrderId.body?.message ?? `status ${malformedOrderId.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after order tests", true);

  const orderLogs = await prisma.activityLog.findMany({
    where: { module: "ORDERS" },
    select: { action: true },
  });
  const requiredOrderActions = [
    "ORDER_SUBMITTED",
    "ORDER_STATUS_CHANGED",
    "ORDER_AUTO_CANCELLED",
  ];
  const missingOrderActions = requiredOrderActions.filter(
    (action) => !orderLogs.some((log) => log.action === action)
  );
  record(
    "ORDERS activity logs recorded",
    missingOrderActions.length === 0,
    missingOrderActions.length
      ? `missing: ${missingOrderActions.join(", ")}`
      : `${orderLogs.length} ORDERS entries`
  );

  // ---- 10e. Payments (Requirement 5) ----------------------------------------
  // State from 10d: order = OQ-F1-YYYY-001 (APPROVED, total 3000),
  // order2 = OQ-VET-YYYY-001 (REJECTED). Role is CLIENT_FARMER.

  const proofOnRejectedOrder = await submitProof(
    idToken,
    order2?.id,
    { paymentType: "FULL", amount: "1050" },
    { buffer: TINY_PNG, filename: "gcash.png", contentType: "image/png" }
  );
  record(
    "Proof on a REJECTED order -> 409 (order not ready)",
    proofOnRejectedOrder.status === 409,
    proofOnRejectedOrder.body?.message ?? `status ${proofOnRejectedOrder.status}`
  );

  const depositSubmit = await submitProof(
    idToken,
    order?.id,
    {
      paymentType: "DEPOSIT",
      amount: "1000",
      paymentDate: "2026-08-13",
      referenceNumber: "TEST-PAY-001",
    },
    { buffer: TINY_PNG, filename: "gcash-deposit.png", contentType: "image/png" }
  );
  const deposit = depositSubmit.body?.data;
  record(
    "POST payment proof (DEPOSIT 1000) -> 201 SUBMITTED with metadata",
    depositSubmit.status === 201 &&
      deposit?.status === "SUBMITTED" &&
      deposit?.paymentType === "DEPOSIT" &&
      deposit?.proofOriginalName === "gcash-deposit.png" &&
      deposit?.proofMimeType === "image/png" &&
      deposit?.proofSizeBytes === TINY_PNG.length &&
      typeof deposit?.proofStorageUrl === "string",
    `${deposit?.paymentType} ${deposit?.amount} -> ${deposit?.proofStorageUrl}`
  );

  const depositHistory = deposit?.statusHistory?.[0];
  record(
    "Payment history starts null -> SUBMITTED",
    deposit?.statusHistory?.length === 1 &&
      depositHistory?.fromStatus === null &&
      depositHistory?.toStatus === "SUBMITTED",
    `${depositHistory?.fromStatus} -> ${depositHistory?.toStatus}`
  );

  const orderAfterProof = await api(`/api/orders/me/${order?.id}`, {
    token: idToken,
  });
  record(
    "Order moved APPROVED -> PAYMENT_SUBMITTED on first proof",
    orderAfterProof.body?.data?.status === "PAYMENT_SUBMITTED",
    `status=${orderAfterProof.body?.data?.status}`
  );

  const proofFileResponse = await fetch(deposit?.proofStorageUrl);
  record(
    "Stored proof file is served at its URL",
    proofFileResponse.status === 200,
    `HTTP ${proofFileResponse.status}`
  );

  const fakeFileProof = await submitProof(
    idToken,
    order?.id,
    { paymentType: "BALANCE", amount: "50" },
    {
      buffer: Buffer.from("just some text pretending to be an image"),
      filename: "receipt.png",
      contentType: "image/png",
    }
  );
  record(
    "Non-image/PDF proof (fake bytes) -> 400",
    fakeFileProof.status === 400,
    fakeFileProof.body?.message ?? `status ${fakeFileProof.status}`
  );

  const missingFileProof = await submitProof(idToken, order?.id, {
    paymentType: "BALANCE",
    amount: "50",
  });
  record(
    "Proof submission without a file -> 400",
    missingFileProof.status === 400,
    missingFileProof.body?.message ?? `status ${missingFileProof.status}`
  );

  const zeroAmountProof = await submitProof(
    idToken,
    order?.id,
    { paymentType: "BALANCE", amount: "0" },
    { buffer: TINY_PNG, filename: "zero.png", contentType: "image/png" }
  );
  record(
    "Proof with amount 0 -> 400",
    zeroAmountProof.status === 400,
    zeroAmountProof.body?.message ?? `status ${zeroAmountProof.status}`
  );

  const myPayments = await api("/api/payments/me", { token: idToken });
  record(
    "GET /api/payments/me -> 200 with customerNumber",
    myPayments.status === 200 &&
      myPayments.body?.count >= 1 &&
      typeof myPayments.body?.customerNumber === "string",
    `count=${myPayments.body?.count} ${myPayments.body?.customerNumber}`
  );

  const farmerPaymentQueue = await api("/api/payments", { token: idToken });
  record(
    "GET /api/payments as farmer -> 403 (staff only)",
    farmerPaymentQueue.status === 403,
    farmerPaymentQueue.body?.message ?? `status ${farmerPaymentQueue.status}`
  );

  // A third order (F1 x1 = 300) for the PDF-proof + rejection flow.
  const orderSubmit3 = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: f1ProductId, quantity: 1 }],
    },
  });
  const order3 = orderSubmit3.body?.data;

  // Staff side: approve order3, then review the deposit.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });
  await api(`/api/orders/${order3?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "APPROVED", notes: "Approved for payment testing." },
  });

  const submittedQueue = await api("/api/payments?status=SUBMITTED", {
    token: idToken,
  });
  const queuedPayment = (submittedQueue.body?.data ?? []).find(
    (entry: any) => entry.id === deposit?.id
  );
  record(
    "GET /api/payments?status=SUBMITTED as staff -> 200 with customer info",
    submittedQueue.status === 200 &&
      queuedPayment?.customerProfile?.customerNumber !== undefined,
    `count=${submittedQueue.body?.count} customer=${queuedPayment?.customerProfile?.customerNumber}`
  );

  const badStatusFilter = await api("/api/payments?status=WEIRD", {
    token: idToken,
  });
  record(
    "GET /api/payments?status=WEIRD -> 400",
    badStatusFilter.status === 400,
    badStatusFilter.body?.message ?? `status ${badStatusFilter.status}`
  );

  const staffPaymentView = await api(`/api/payments/${deposit?.id}`, {
    token: idToken,
  });
  record(
    "GET /api/payments/:paymentId as staff -> 200 with order + history",
    staffPaymentView.status === 200 &&
      staffPaymentView.body?.data?.order?.orderNumber === order?.orderNumber &&
      Array.isArray(staffPaymentView.body?.data?.statusHistory),
    `payment for ${staffPaymentView.body?.data?.order?.orderNumber}`
  );

  const verifyDeposit = await api(`/api/payments/${deposit?.id}/verify`, {
    method: "PATCH",
    token: idToken,
    body: { notes: "Deposit reviewed and confirmed." },
  });
  record(
    "PATCH verify DEPOSIT -> VERIFIED, order NOT fully paid yet",
    verifyDeposit.status === 200 &&
      verifyDeposit.body?.data?.status === "VERIFIED" &&
      verifyDeposit.body?.orderStatusUpdated === false &&
      Number(verifyDeposit.body?.verifiedTotal) === 1000 &&
      verifyDeposit.body?.data?.verifiedBy?.email !== undefined,
    `verifiedTotal=${verifyDeposit.body?.verifiedTotal} orderUpdated=${verifyDeposit.body?.orderStatusUpdated}`
  );

  const doubleVerify = await api(`/api/payments/${deposit?.id}/verify`, {
    method: "PATCH",
    token: idToken,
    body: {},
  });
  record(
    "Verifying the same payment again -> 409",
    doubleVerify.status === 409,
    doubleVerify.body?.message ?? `status ${doubleVerify.status}`
  );

  // Back to farmer: balance for order1, PDF proof for order3.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const balanceSubmit = await submitProof(
    idToken,
    order?.id,
    { paymentType: "BALANCE", amount: "2000", referenceNumber: "TEST-PAY-002" },
    { buffer: TINY_JPEG, filename: "gcash-balance.jpg", contentType: "image/jpeg" }
  );
  const balance = balanceSubmit.body?.data;

  const pdfSubmit = await submitProof(
    idToken,
    order3?.id,
    { paymentType: "FULL", amount: "300", referenceNumber: "TEST-PAY-003" },
    { buffer: TINY_PDF, filename: "bank-receipt.pdf", contentType: "application/pdf" }
  );
  const pdfPayment = pdfSubmit.body?.data;
  record(
    "PDF payment proof accepted -> 201 (application/pdf)",
    pdfSubmit.status === 201 &&
      pdfPayment?.proofMimeType === "application/pdf" &&
      (pdfPayment?.proofStorageUrl ?? "").endsWith(".pdf"),
    `${pdfPayment?.proofOriginalName} -> ${pdfPayment?.proofStorageUrl}`
  );

  // Staff again: verify the balance (completes 1000+2000=3000) and
  // reject the PDF proof.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const verifyBalance = await api(`/api/payments/${balance?.id}/verify`, {
    method: "PATCH",
    token: idToken,
    body: { notes: "Balance confirmed. Order fully paid." },
  });
  record(
    "Verify BALANCE -> deposit+balance covers total, order auto-updates",
    verifyBalance.status === 200 &&
      verifyBalance.body?.orderStatusUpdated === true &&
      Number(verifyBalance.body?.verifiedTotal) === 3000,
    `verifiedTotal=${verifyBalance.body?.verifiedTotal} orderUpdated=${verifyBalance.body?.orderStatusUpdated}`
  );

  const orderFullyPaid = await api(`/api/orders/${order?.id}`, {
    token: idToken,
  });
  const paidHistory = (orderFullyPaid.body?.data?.statusHistory ?? []).map(
    (entry: any) => entry.toStatus
  );
  record(
    "Order history: PENDING -> APPROVED -> PAYMENT_SUBMITTED -> PAYMENT_VERIFIED",
    orderFullyPaid.body?.data?.status === "PAYMENT_VERIFIED" &&
      JSON.stringify(paidHistory) ===
        JSON.stringify([
          "PENDING",
          "APPROVED",
          "PAYMENT_SUBMITTED",
          "PAYMENT_VERIFIED",
        ]),
    paidHistory.join(" -> ")
  );

  const rejectWithoutReason = await api(
    `/api/payments/${pdfPayment?.id}/reject`,
    { method: "PATCH", token: idToken, body: {} }
  );
  record(
    "Reject without a reason -> 400",
    rejectWithoutReason.status === 400,
    rejectWithoutReason.body?.message ?? `status ${rejectWithoutReason.status}`
  );

  const rejectPdf = await api(`/api/payments/${pdfPayment?.id}/reject`, {
    method: "PATCH",
    token: idToken,
    body: { rejectionReason: "The uploaded receipt is unreadable." },
  });
  record(
    "Reject payment -> REJECTED with reason preserved",
    rejectPdf.status === 200 &&
      rejectPdf.body?.data?.status === "REJECTED" &&
      rejectPdf.body?.data?.rejectionReason ===
        "The uploaded receipt is unreadable.",
    `${rejectPdf.body?.data?.status}: ${rejectPdf.body?.data?.rejectionReason}`
  );

  const order3AfterReject = await api(`/api/orders/${order3?.id}`, {
    token: idToken,
  });
  record(
    "Order stays PAYMENT_SUBMITTED after rejection (farmer can retry)",
    order3AfterReject.body?.data?.status === "PAYMENT_SUBMITTED",
    `status=${order3AfterReject.body?.data?.status}`
  );

  const doubleReject = await api(`/api/payments/${pdfPayment?.id}/reject`, {
    method: "PATCH",
    token: idToken,
    body: { rejectionReason: "Second attempt." },
  });
  record(
    "Rejecting the same payment again -> 409",
    doubleReject.status === 409,
    doubleReject.body?.message ?? `status ${doubleReject.status}`
  );

  const ghostPaymentVerify = await api(
    "/api/payments/00000000-0000-0000-0000-000000000000/verify",
    { method: "PATCH", token: idToken, body: {} }
  );
  const malformedPaymentId = await api("/api/payments/hello", {
    token: idToken,
  });
  record(
    "Unknown payment -> 404, malformed payment ID -> 400",
    ghostPaymentVerify.status === 404 && malformedPaymentId.status === 400,
    `${ghostPaymentVerify.status} / ${malformedPaymentId.status}`
  );

  // Staff-recorded payment (customers email their proof; staff enter it).
  const recordOnPending = await api(
    `/api/payments/orders/${secondF1Order?.id}/record`,
    {
      method: "POST",
      token: idToken,
      body: { paymentType: "FULL", amount: 300 },
    }
  );
  record(
    "Staff record payment on a PENDING order -> 409 (approve first)",
    recordOnPending.status === 409,
    recordOnPending.body?.message ?? `status ${recordOnPending.status}`
  );

  const staffRecord = await api(`/api/payments/orders/${order3?.id}/record`, {
    method: "POST",
    token: idToken,
    body: {
      paymentType: "FULL",
      amount: 300,
      paymentDate: "2026-08-20",
      referenceNumber: "EMAIL-PROOF-001",
      notes: "Proof received at dacs@gmail.com.",
    },
  });
  const staffPayment = staffRecord.body?.data;
  record(
    "Staff record payment -> 201 VERIFIED, no proof file, covers total",
    staffRecord.status === 201 &&
      staffPayment?.status === "VERIFIED" &&
      staffPayment?.proofStorageUrl === null &&
      staffPayment?.verifiedBy?.email !== undefined &&
      Number(staffRecord.body?.verifiedTotal) === 300 &&
      staffRecord.body?.orderStatusUpdated === true,
    `verifiedTotal=${staffRecord.body?.verifiedTotal} proof=${staffPayment?.proofStorageUrl}`
  );

  const order3AfterRecord = await api(`/api/orders/${order3?.id}`, {
    token: idToken,
  });
  record(
    "Order becomes PAYMENT_VERIFIED after staff-recorded payment",
    order3AfterRecord.body?.data?.status === "PAYMENT_VERIFIED",
    `status=${order3AfterRecord.body?.data?.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after payment tests", true);

  const farmerRecordAttempt = await api(
    `/api/payments/orders/${order3?.id}/record`,
    {
      method: "POST",
      token: idToken,
      body: { paymentType: "FULL", amount: 300 },
    }
  );
  record(
    "Farmer cannot use the staff record-payment endpoint -> 403",
    farmerRecordAttempt.status === 403,
    farmerRecordAttempt.body?.message ?? `status ${farmerRecordAttempt.status}`
  );

  const paymentLogs = await prisma.activityLog.findMany({
    where: { module: "PAYMENTS" },
    select: { action: true },
  });
  const requiredPaymentActions = [
    "PAYMENT_PROOF_SUBMITTED",
    "PAYMENT_VERIFIED",
    "PAYMENT_REJECTED",
    "PAYMENT_RECORDED_BY_STAFF",
  ];
  const missingPaymentActions = requiredPaymentActions.filter(
    (action) => !paymentLogs.some((log) => log.action === action)
  );
  record(
    "PAYMENTS activity logs recorded",
    missingPaymentActions.length === 0,
    missingPaymentActions.length
      ? `missing: ${missingPaymentActions.join(", ")}`
      : `${paymentLogs.length} PAYMENTS entries`
  );

  // ---- 10f. Seminars + certificates + Parent Stock unlock (Requirement 6) ----
  // Role is CLIENT_FARMER here. TEST_PASSING_SCORE is suite data only —
  // the real passing grade is whatever staff configures per module.
  const TEST_PASSING_SCORE = 75;

  const farmerCreateModule = await api("/api/seminars/modules", {
    method: "POST",
    token: idToken,
    body: { moduleNumber: 9, title: "Hack", passingScore: 1 },
  });
  record(
    "POST /api/seminars/modules as farmer -> 403",
    farmerCreateModule.status === 403,
    farmerCreateModule.body?.message ?? `status ${farmerCreateModule.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const moduleBodies = [
    { moduleNumber: 1, title: "Poultry Raising Basics", passingScore: TEST_PASSING_SCORE },
    { moduleNumber: 2, title: "Dominant Breed Management", passingScore: TEST_PASSING_SCORE },
    { moduleNumber: 3, title: "Biosecurity and Health", passingScore: TEST_PASSING_SCORE },
  ];
  const createdModules: any[] = [];
  for (const body of moduleBodies) {
    const created = await api("/api/seminars/modules", {
      method: "POST",
      token: idToken,
      body,
    });
    createdModules.push(created.body?.data);
  }
  record(
    "POST seminar Modules 1, 2, 3 -> 201 unpublished",
    createdModules.length === 3 &&
      createdModules.every(
        (module) => module?.id && module?.isPublished === false
      ),
    createdModules.map((module) => `M${module?.moduleNumber}`).join(", ")
  );

  const duplicateModule = await api("/api/seminars/modules", {
    method: "POST",
    token: idToken,
    body: { moduleNumber: 1, title: "Duplicate", passingScore: 50 },
  });
  record(
    "POST duplicate module number -> 409",
    duplicateModule.status === 409,
    duplicateModule.body?.message ?? `status ${duplicateModule.status}`
  );

  const badPassingScore = await api(
    `/api/seminars/modules/${createdModules[0]?.id}`,
    { method: "PATCH", token: idToken, body: { passingScore: 150 } }
  );
  record(
    "PATCH passingScore 150 -> 400",
    badPassingScore.status === 400,
    badPassingScore.body?.message ?? `status ${badPassingScore.status}`
  );

  const createdVideos: any[] = [];
  for (const module of createdModules) {
    const video = await api(`/api/seminars/modules/${module?.id}/videos`, {
      method: "POST",
      token: idToken,
      body: {
        title: `Module ${module?.moduleNumber} Lecture`,
        videoUrl: `https://videos.dacs.example/module-${module?.moduleNumber}.mp4`,
      },
    });
    createdVideos.push(video.body?.data);
  }
  record(
    "POST one video per module -> 201",
    createdVideos.every((video) => video?.id),
    `${createdVideos.length} videos`
  );

  const badQuestion = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/questions`,
    {
      method: "POST",
      token: idToken,
      body: {
        questionText: "No correct answer?",
        choices: [
          { choiceText: "A", isCorrect: false },
          { choiceText: "B", isCorrect: false },
        ],
      },
    }
  );
  record(
    "POST question without exactly one correct choice -> 400",
    badQuestion.status === 400,
    badQuestion.body?.message ?? `status ${badQuestion.status}`
  );

  // Module 1 gets two questions; Modules 2 and 3 get one each. The staff
  // creation response includes isCorrect, which the suite uses to know
  // the right (and wrong) answers later.
  async function createQuestion(
    moduleId: string,
    questionText: string,
    correctFirst: boolean
  ): Promise<any> {
    const created = await api(`/api/seminars/modules/${moduleId}/questions`, {
      method: "POST",
      token: idToken,
      body: {
        questionText,
        choices: [
          { choiceText: "Answer A", isCorrect: correctFirst },
          { choiceText: "Answer B", isCorrect: !correctFirst },
        ],
      },
    });
    return created.body?.data;
  }

  const questionM1a = await createQuestion(
    createdModules[0]?.id,
    "M1 Question 1",
    true
  );
  const questionM1b = await createQuestion(
    createdModules[0]?.id,
    "M1 Question 2",
    false
  );
  const questionM2 = await createQuestion(
    createdModules[1]?.id,
    "M2 Question 1",
    true
  );
  const questionM3 = await createQuestion(
    createdModules[2]?.id,
    "M3 Question 1",
    true
  );
  record(
    "POST quiz questions (2 + 1 + 1) -> 201 with choices",
    [questionM1a, questionM1b, questionM2, questionM3].every(
      (question) => question?.id && question?.choices?.length === 2
    ),
    "4 questions created"
  );

  const correctChoice = (question: any) =>
    question?.choices?.find((choice: any) => choice.isCorrect === true)?.id;
  const wrongChoice = (question: any) =>
    question?.choices?.find((choice: any) => choice.isCorrect === false)?.id;

  // Farmers must not see drafts.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const draftList = await api("/api/seminars/modules", { token: idToken });
  record(
    "Unpublished modules hidden from farmers",
    draftList.status === 200 && draftList.body?.count === 0,
    `count=${draftList.body?.count}`
  );

  const startDraft = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/start`,
    { method: "POST", token: idToken }
  );
  record(
    "Starting an unpublished module -> 404",
    startDraft.status === 404,
    startDraft.body?.message ?? `status ${startDraft.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });
  const publishResults: number[] = [];
  for (const module of createdModules) {
    const published = await api(`/api/seminars/modules/${module?.id}`, {
      method: "PATCH",
      token: idToken,
      body: { isPublished: true },
    });
    publishResults.push(published.status);
  }
  record(
    "PATCH publish Modules 1-3 -> 200",
    publishResults.every((status) => status === 200),
    publishResults.join(", ")
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const publishedList = await api("/api/seminars/modules", { token: idToken });
  record(
    "Published modules visible to farmer, no isCorrect anywhere",
    publishedList.status === 200 &&
      publishedList.body?.count === 3 &&
      !JSON.stringify(publishedList.body).includes("isCorrect"),
    `count=${publishedList.body?.count}`
  );

  const startModule1 = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/start`,
    { method: "POST", token: idToken }
  );
  record(
    "POST start Module 1 -> enrollment",
    startModule1.status === 200 && startModule1.body?.data?.id !== undefined,
    `enrollment ${startModule1.body?.data?.id ?? "missing"}`
  );

  const badProgress = await api(
    `/api/seminars/videos/${createdVideos[0]?.id}/progress`,
    { method: "PATCH", token: idToken, body: { progressPercent: 150 } }
  );
  record(
    "PATCH video progress 150 -> 400",
    badProgress.status === 400,
    badProgress.body?.message ?? `status ${badProgress.status}`
  );

  const halfProgress = await api(
    `/api/seminars/videos/${createdVideos[0]?.id}/progress`,
    { method: "PATCH", token: idToken, body: { progressPercent: 50 } }
  );
  record(
    "PATCH video progress 50 -> saved, module not complete",
    halfProgress.status === 200 &&
      halfProgress.body?.data?.progressPercent === 50 &&
      halfProgress.body?.moduleCompleted === false,
    `progress=${halfProgress.body?.data?.progressPercent}`
  );

  const regressProgress = await api(
    `/api/seminars/videos/${createdVideos[0]?.id}/progress`,
    { method: "PATCH", token: idToken, body: { progressPercent: 20 } }
  );
  record(
    "Progress cannot move backwards (20 after 50 stays 50)",
    regressProgress.status === 200 &&
      regressProgress.body?.data?.progressPercent === 50,
    `progress=${regressProgress.body?.data?.progressPercent}`
  );

  const quizPayload = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    { token: idToken }
  );
  record(
    "GET quiz -> questions + choices, isCorrect stripped",
    quizPayload.status === 200 &&
      quizPayload.body?.data?.questions?.length === 2 &&
      !JSON.stringify(quizPayload.body).includes("isCorrect"),
    `questions=${quizPayload.body?.data?.questions?.length}`
  );

  const incompleteQuiz = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    {
      method: "POST",
      token: idToken,
      body: {
        answers: [
          { questionId: questionM1a?.id, choiceId: correctChoice(questionM1a) },
        ],
      },
    }
  );
  const duplicateQuestionQuiz = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    {
      method: "POST",
      token: idToken,
      body: {
        answers: [
          { questionId: questionM1a?.id, choiceId: correctChoice(questionM1a) },
          { questionId: questionM1a?.id, choiceId: wrongChoice(questionM1a) },
        ],
      },
    }
  );
  const crossWiredQuiz = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    {
      method: "POST",
      token: idToken,
      body: {
        answers: [
          { questionId: questionM1a?.id, choiceId: correctChoice(questionM1b) },
          { questionId: questionM1b?.id, choiceId: correctChoice(questionM1b) },
        ],
      },
    }
  );
  record(
    "Malformed quiz submissions -> 400 (incomplete / duplicate / cross-wired)",
    incompleteQuiz.status === 400 &&
      duplicateQuestionQuiz.status === 400 &&
      crossWiredQuiz.status === 400,
    `${incompleteQuiz.status} / ${duplicateQuestionQuiz.status} / ${crossWiredQuiz.status}`
  );

  const failQuiz = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    {
      method: "POST",
      token: idToken,
      body: {
        answers: [
          { questionId: questionM1a?.id, choiceId: wrongChoice(questionM1a) },
          { questionId: questionM1b?.id, choiceId: wrongChoice(questionM1b) },
        ],
      },
    }
  );
  record(
    "Quiz with wrong answers -> scored 0, failed",
    failQuiz.status === 200 &&
      failQuiz.body?.data?.score === 0 &&
      failQuiz.body?.data?.passed === false,
    `${failQuiz.body?.data?.score}/${failQuiz.body?.data?.totalScore} (pass=${failQuiz.body?.data?.passed})`
  );

  const passQuiz = await api(
    `/api/seminars/modules/${createdModules[0]?.id}/quiz`,
    {
      method: "POST",
      token: idToken,
      body: {
        answers: [
          { questionId: questionM1a?.id, choiceId: correctChoice(questionM1a) },
          { questionId: questionM1b?.id, choiceId: correctChoice(questionM1b) },
        ],
      },
    }
  );
  record(
    "Quiz with correct answers -> passed, module still needs the video",
    passQuiz.status === 200 &&
      passQuiz.body?.data?.passed === true &&
      passQuiz.body?.data?.percentage === 100 &&
      passQuiz.body?.data?.moduleCompleted === false,
    `${passQuiz.body?.data?.percentage}% (completed=${passQuiz.body?.data?.moduleCompleted})`
  );

  const fullProgress = await api(
    `/api/seminars/videos/${createdVideos[0]?.id}/progress`,
    { method: "PATCH", token: idToken, body: { progressPercent: 100 } }
  );
  record(
    "Video reaches 100% -> Module 1 completes (video + quiz rule)",
    fullProgress.status === 200 && fullProgress.body?.moduleCompleted === true,
    `moduleCompleted=${fullProgress.body?.moduleCompleted}`
  );

  const regressAfterComplete = await api(
    `/api/seminars/videos/${createdVideos[0]?.id}/progress`,
    { method: "PATCH", token: idToken, body: { progressPercent: 40 } }
  );
  record(
    "Progress stays 100 after completion (40 ignored, module stays complete)",
    regressAfterComplete.status === 200 &&
      regressAfterComplete.body?.data?.progressPercent === 100 &&
      regressAfterComplete.body?.moduleCompleted === true,
    `progress=${regressAfterComplete.body?.data?.progressPercent} completed=${regressAfterComplete.body?.moduleCompleted}`
  );

  const parentStockStillLocked = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "PARENT_STOCK",
      items: [{ productId: parentStockId, quantity: 2 }],
    },
  });
  record(
    "Parent Stock with only Module 1 done -> still 409",
    parentStockStillLocked.status === 409,
    parentStockStillLocked.body?.message ??
      `status ${parentStockStillLocked.status}`
  );

  const earlyCertificate = await api("/api/seminars/certificates/request", {
    method: "POST",
    token: idToken,
  });
  record(
    "Certificate request before Modules 2-3 -> 409",
    earlyCertificate.status === 409,
    earlyCertificate.body?.message ?? `status ${earlyCertificate.status}`
  );

  // Complete Modules 2 and 3: start -> video 100% -> pass quiz.
  let lastCompletion = false;
  for (const [index, question] of [questionM2, questionM3].entries()) {
    const module = createdModules[index + 1];
    const video = createdVideos[index + 1];

    await api(`/api/seminars/modules/${module?.id}/start`, {
      method: "POST",
      token: idToken,
    });
    await api(`/api/seminars/videos/${video?.id}/progress`, {
      method: "PATCH",
      token: idToken,
      body: { progressPercent: 100 },
    });
    const quiz = await api(`/api/seminars/modules/${module?.id}/quiz`, {
      method: "POST",
      token: idToken,
      body: {
        answers: [{ questionId: question?.id, choiceId: correctChoice(question) }],
      },
    });
    lastCompletion = quiz.body?.data?.moduleCompleted === true;
  }
  record(
    "Modules 2 and 3 completed via video + passing quiz",
    lastCompletion,
    `final moduleCompleted=${lastCompletion}`
  );

  const overallProgress = await api("/api/seminars/me/progress", {
    token: idToken,
  });
  record(
    "GET /me/progress -> 3/3 required modules, Parent Stock unlocked",
    overallProgress.status === 200 &&
      overallProgress.body?.data?.completedRequiredModules === 3 &&
      overallProgress.body?.data?.parentStockUnlocked === true,
    `completed=${overallProgress.body?.data?.completedRequiredModules} unlocked=${overallProgress.body?.data?.parentStockUnlocked}`
  );

  // Completing the trio AUTO-ISSUES the certificate — no request call.
  const autoIssued = await api("/api/seminars/certificates/me", {
    token: idToken,
  });
  const autoCertificate = (autoIssued.body?.data ?? []).find(
    (entry: any) => entry.status === "APPROVED"
  );
  record(
    "Certificate auto-issued APPROVED on completing Modules 1-3",
    autoIssued.status === 200 &&
      /^SEM-\d{4}-\d{6}$/.test(autoCertificate?.certificateNumber ?? "") &&
      autoCertificate?.certificateIssuedAt !== null,
    `${autoCertificate?.certificateNumber ?? "no auto certificate"}`
  );

  const requestWhileIssued = await api("/api/seminars/certificates/request", {
    method: "POST",
    token: idToken,
  });
  record(
    "Manual request while auto-issued certificate exists -> 409",
    requestWhileIssued.status === 409,
    requestWhileIssued.body?.message ?? `status ${requestWhileIssued.status}`
  );

  const farmerApprove = await api(
    `/api/seminars/certificates/${autoCertificate?.id}/approve`,
    { method: "PATCH", token: idToken, body: {} }
  );
  record(
    "Farmer approving a certificate -> 403",
    farmerApprove.status === 403,
    farmerApprove.body?.message ?? `status ${farmerApprove.status}`
  );

  // Legacy fallback: farmers who completed 1-3 BEFORE auto-issue existed
  // still use POST /certificates/request. Simulate by removing the auto
  // row, then exercise the classic request -> staff review path.
  await prisma.certificateRequest.delete({
    where: { id: autoCertificate?.id ?? "" },
  });

  const certificateRequestCall = await api(
    "/api/seminars/certificates/request",
    { method: "POST", token: idToken }
  );
  const certificateRequest = certificateRequestCall.body?.data;
  record(
    "Legacy manual request (no active certificate) -> 201 PENDING",
    certificateRequestCall.status === 201 &&
      certificateRequest?.status === "PENDING",
    `status=${certificateRequest?.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const pendingCertificates = await api(
    "/api/seminars/certificates?status=PENDING",
    { token: idToken }
  );
  record(
    "GET /certificates?status=PENDING as staff -> includes request",
    pendingCertificates.status === 200 &&
      (pendingCertificates.body?.data ?? []).some(
        (entry: any) => entry.id === certificateRequest?.id
      ),
    `count=${pendingCertificates.body?.count}`
  );

  const approveCertificateCall = await api(
    `/api/seminars/certificates/${certificateRequest?.id}/approve`,
    {
      method: "PATCH",
      token: idToken,
      body: { notes: "All three modules verified complete." },
    }
  );
  const approvedCertificate = approveCertificateCall.body?.data;
  record(
    "PATCH approve -> APPROVED with SEM-YYYY-XXXXXX number",
    approveCertificateCall.status === 200 &&
      approvedCertificate?.status === "APPROVED" &&
      /^SEM-\d{4}-\d{6}$/.test(approvedCertificate?.certificateNumber ?? "") &&
      approvedCertificate?.certificateIssuedAt !== null,
    `${approvedCertificate?.certificateNumber}`
  );

  const doubleApprove = await api(
    `/api/seminars/certificates/${certificateRequest?.id}/approve`,
    { method: "PATCH", token: idToken, body: {} }
  );
  record(
    "Approving the same request again -> 409",
    doubleApprove.status === 409,
    doubleApprove.body?.message ?? `status ${doubleApprove.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const myCertificates = await api("/api/seminars/certificates/me", {
    token: idToken,
  });
  record(
    "GET /certificates/me -> approved certificate visible",
    myCertificates.status === 200 &&
      (myCertificates.body?.data ?? []).some(
        (entry: any) => entry.status === "APPROVED" && entry.certificateNumber
      ),
    `count=${myCertificates.body?.count}`
  );

  const parentStockUnlocked = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "PARENT_STOCK",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: parentStockId, quantity: 2 }],
    },
  });
  record(
    "Parent Stock order after Modules 1-3 -> 201 PENDING (Req 6 integration)",
    parentStockUnlocked.status === 201 &&
      parentStockUnlocked.body?.data?.status === "PENDING" &&
      parentStockUnlocked.body?.data?.orderType === "PARENT_STOCK" &&
      Number(parentStockUnlocked.body?.data?.totalAmount) === 2000,
    `${parentStockUnlocked.body?.data?.orderNumber} total=${parentStockUnlocked.body?.data?.totalAmount}`
  );
  record("Role is CLIENT_FARMER after seminar tests", true);

  const seminarLogs = await prisma.activityLog.findMany({
    where: { module: "SEMINARS" },
    select: { action: true },
  });
  const requiredSeminarActions = [
    "SEMINAR_MODULE_CREATED",
    "SEMINAR_MODULE_UPDATED",
    "SEMINAR_VIDEO_CREATED",
    "SEMINAR_QUESTION_CREATED",
    "SEMINAR_QUIZ_SUBMITTED",
    "CERTIFICATE_AUTO_ISSUED",
    "CERTIFICATE_REQUESTED",
    "CERTIFICATE_APPROVED",
  ];
  const missingSeminarActions = requiredSeminarActions.filter(
    (action) => !seminarLogs.some((log) => log.action === action)
  );
  record(
    "SEMINARS activity logs recorded",
    missingSeminarActions.length === 0,
    missingSeminarActions.length
      ? `missing: ${missingSeminarActions.join(", ")}`
      : `${seminarLogs.length} SEMINARS entries`
  );

  // ---- 10g. Breeder registry (Requirement 7) --------------------------------
  // State: role CLIENT_FARMER; the Parent Stock order from 10f (PENDING).
  const psOrder = parentStockUnlocked.body?.data;

  const emptyBreederStatus = await api("/api/breeders/me", { token: idToken });
  record(
    "GET /api/breeders/me before any release -> 200 empty",
    emptyBreederStatus.status === 200 && emptyBreederStatus.body?.count === 0,
    `count=${emptyBreederStatus.body?.count}`
  );

  const farmerRegistry = await api("/api/breeders", { token: idToken });
  record(
    "GET /api/breeders as farmer -> 403 (staff only)",
    farmerRegistry.status === 403,
    farmerRegistry.body?.message ?? `status ${farmerRegistry.status}`
  );

  // Walk the Parent Stock order to the release event. The payment steps
  // were exercised in 10e, so jump straight to PROCESSING and use the
  // real API for the transitions that matter: SHIPPED, then DELIVERED
  // (delivery of a Parent Stock order is the release event).
  await prisma.order.update({
    where: { id: psOrder?.id },
    data: { status: "PROCESSING" },
  });
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const shipPs = await api(`/api/orders/${psOrder?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "SHIPPED", notes: "Handed to transporter." },
  });
  record(
    "PATCH Parent Stock PROCESSING -> SHIPPED (no release yet)",
    shipPs.status === 200 &&
      shipPs.body?.data?.status === "SHIPPED" &&
      shipPs.body?.data?.releasedAt === null,
    `status=${shipPs.body?.data?.status} releasedAt=${shipPs.body?.data?.releasedAt}`
  );

  const fulfillPs = await api(`/api/orders/${psOrder?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "DELIVERED", notes: "Parent Stock released to farmer." },
  });
  record(
    "PATCH Parent Stock SHIPPED -> DELIVERED stamps releasedAt",
    fulfillPs.status === 200 &&
      fulfillPs.body?.data?.status === "DELIVERED" &&
      fulfillPs.body?.data?.releasedAt !== null,
    `releasedAt=${fulfillPs.body?.data?.releasedAt}`
  );

  const registry = await api("/api/breeders", { token: idToken });
  const breederRecord = (registry.body?.data ?? []).find(
    (entry: any) => entry.parentStockOrder?.orderNumber === psOrder?.orderNumber
  );
  const monitoringId = breederRecord?.id;
  const dayDiff =
    breederRecord &&
    Math.round(
      (new Date(breederRecord.eligibleAt).getTime() -
        new Date(breederRecord.releasedAt).getTime()) /
        86_400_000
    );
  record(
    "Release auto-created monitoring: eligibleAt = releasedAt + 90 days",
    registry.status === 200 &&
      breederRecord !== undefined &&
      dayDiff === 90 &&
      breederRecord.overallStatus === "PENDING" &&
      breederRecord.eligibility?.status === "PENDING",
    `+${dayDiff} days, overall=${breederRecord?.overallStatus}`
  );

  const breederDetail = await api(`/api/breeders/${monitoringId}`, {
    token: idToken,
  });
  record(
    "GET /api/breeders/:monitoringId -> 200 with farm + customer + order",
    breederDetail.status === 200 &&
      breederDetail.body?.data?.farm?.id !== undefined &&
      breederDetail.body?.data?.customerProfile?.customerNumber ===
        myCustomerNumber,
    `farm=${breederDetail.body?.data?.farm?.farmName}`
  );

  // numberAlive is free text ("D853 - 30f + 6m"), so a raw number is
  // rejected as the wrong type.
  const numericAlive = await api(`/api/breeders/${monitoringId}/monitoring`, {
    method: "PATCH",
    token: idToken,
    body: { numberAlive: -5 },
  });
  record(
    "PATCH monitoring with non-text numberAlive -> 400",
    numericAlive.status === 400,
    numericAlive.body?.message ?? `status ${numericAlive.status}`
  );

  const monitoringUpdate = await api(
    `/api/breeders/${monitoringId}/monitoring`,
    {
      method: "PATCH",
      token: idToken,
      body: {
        numberAlive: "D853 - 30f + 6m",
        vaccinationRecords: "NDV and fowl pox vaccinations completed.",
        feedingManagement: "Grower feed, twice daily.",
      },
    }
  );
  record(
    "PATCH monitoring details -> 200 (free-text numberAlive)",
    monitoringUpdate.status === 200 &&
      monitoringUpdate.body?.data?.numberAlive === "D853 - 30f + 6m",
    `numberAlive=${monitoringUpdate.body?.data?.numberAlive}`
  );

  const earlyEligible = await api(`/api/breeders/${monitoringId}/eligibility`, {
    method: "PATCH",
    token: idToken,
    body: { decision: "ELIGIBLE" },
  });
  record(
    "Approving eligibility before 90 days -> 409 (waiting period)",
    earlyEligible.status === 409,
    earlyEligible.body?.message ?? `status ${earlyEligible.status}`
  );

  const markIneligible = await api(
    `/api/breeders/${monitoringId}/eligibility`,
    {
      method: "PATCH",
      token: idToken,
      body: { decision: "INELIGIBLE", remarks: "High mortality observed." },
    }
  );
  record(
    "Marking INELIGIBLE works at any time -> 200",
    markIneligible.status === 200 &&
      markIneligible.body?.data?.status === "INELIGIBLE",
    `status=${markIneligible.body?.data?.status}`
  );

  const certifyIneligible = await api(`/api/breeders/${monitoringId}/certify`, {
    method: "POST",
    token: idToken,
    body: {},
  });
  record(
    "Certifying an ineligible breeder -> 409",
    certifyIneligible.status === 409,
    certifyIneligible.body?.message ?? `status ${certifyIneligible.status}`
  );

  // Time-travel: simulate the 90-day waiting period having passed.
  const pastEligibleAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.breederMonitoring.update({
    where: { id: monitoringId },
    data: { eligibleAt: pastEligibleAt },
  });
  await prisma.breederEligibility.update({
    where: { monitoringId },
    data: { eligibleAt: pastEligibleAt },
  });

  const nowEligible = await api(`/api/breeders/${monitoringId}/eligibility`, {
    method: "PATCH",
    token: idToken,
    body: { decision: "ELIGIBLE", remarks: "Re-evaluated after 90 days." },
  });
  record(
    "Re-evaluation after 90 days -> ELIGIBLE with evaluator recorded",
    nowEligible.status === 200 &&
      nowEligible.body?.data?.status === "ELIGIBLE" &&
      nowEligible.body?.data?.evaluatedByUserId === dacsUserId,
    `status=${nowEligible.body?.data?.status}`
  );

  const certify = await api(`/api/breeders/${monitoringId}/certify`, {
    method: "POST",
    token: idToken,
    body: { remarks: "All monitoring requirements satisfied." },
  });
  const certification = certify.body?.data;
  const certYearDiff =
    certification &&
    new Date(certification.expiresAt).getUTCFullYear() -
      new Date(certification.certifiedAt).getUTCFullYear();
  record(
    "POST certify -> 201 ACTIVE, BRD number, expires in 2 years",
    certify.status === 201 &&
      certification?.status === "ACTIVE" &&
      /^BRD-\d{4}-\d{6}$/.test(certification?.certificateNumber ?? "") &&
      certYearDiff === 2,
    `${certification?.certificateNumber} expires ${String(certification?.expiresAt).slice(0, 10)}`
  );

  const doubleCertify = await api(`/api/breeders/${monitoringId}/certify`, {
    method: "POST",
    token: idToken,
    body: {},
  });
  record(
    "Certifying again while ACTIVE -> 409",
    doubleCertify.status === 409,
    doubleCertify.body?.message ?? `status ${doubleCertify.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });

  const activeBreederStatus = await api("/api/breeders/me", { token: idToken });
  const myBreeder = (activeBreederStatus.body?.data ?? [])[0];
  record(
    "GET /api/breeders/me -> overall ACTIVE with certificate + monitoring",
    activeBreederStatus.status === 200 &&
      myBreeder?.overallStatus === "ACTIVE" &&
      myBreeder?.certification?.certificateNumber ===
        certification?.certificateNumber &&
      myBreeder?.monitoring?.numberAlive === "D853 - 30f + 6m",
    `overall=${myBreeder?.overallStatus} cert=${myBreeder?.certification?.certificateNumber}`
  );

  // Time-travel again: certification expiry passes -> EXPIRED on read.
  await prisma.breederCertification.update({
    where: { id: certification?.id },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  });

  const expiredBreederStatus = await api("/api/breeders/me", { token: idToken });
  const expiredBreeder = (expiredBreederStatus.body?.data ?? [])[0];
  record(
    "Expired certificate auto-detected -> overall EXPIRED",
    expiredBreederStatus.status === 200 &&
      expiredBreeder?.overallStatus === "EXPIRED" &&
      expiredBreeder?.certification?.status === "EXPIRED",
    `overall=${expiredBreeder?.overallStatus}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const expiredFilter = await api("/api/breeders?status=EXPIRED", {
    token: idToken,
  });
  const badBreederFilter = await api("/api/breeders?status=WEIRD", {
    token: idToken,
  });
  record(
    "Registry filter: status=EXPIRED finds record, WEIRD -> 400",
    expiredFilter.status === 200 &&
      (expiredFilter.body?.data ?? []).some(
        (entry: any) => entry.id === monitoringId
      ) &&
      badBreederFilter.status === 400,
    `expired count=${expiredFilter.body?.count} / ${badBreederFilter.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after breeder tests", true);

  const breederLogs = await prisma.activityLog.findMany({
    where: { module: "BREEDERS" },
    select: { action: true },
  });
  const requiredBreederActions = [
    "BREEDER_MONITORING_STARTED",
    "BREEDER_MONITORING_UPDATED",
    "BREEDER_ELIGIBILITY_APPROVED",
    "BREEDER_ELIGIBILITY_REJECTED",
    "BREEDER_CERTIFICATE_ISSUED",
  ];
  const missingBreederActions = requiredBreederActions.filter(
    (action) => !breederLogs.some((log) => log.action === action)
  );
  record(
    "BREEDERS activity logs recorded",
    missingBreederActions.length === 0,
    missingBreederActions.length
      ? `missing: ${missingBreederActions.join(", ")}`
      : `${breederLogs.length} BREEDERS entries`
  );

  // ---- 10h. Inquiry tickets (Requirement 8) ---------------------------------
  // Role is CLIENT_FARMER. History rows cascade with the tickets.
  await prisma.inquiryTicket.deleteMany({
    where: { customerProfile: { userId: dacsUserId } },
  });

  const inquirySubmit = await api("/api/inquiries", {
    method: "POST",
    token: idToken,
    body: {
      subject: "Question about Parent Stock",
      message: "I would like to ask about the next available Parent Stock schedule.",
    },
  });
  const inquiry = inquirySubmit.body?.data;
  record(
    "POST /api/inquiries -> 201 SUBMITTED with INQ number",
    inquirySubmit.status === 201 &&
      /^INQ-\d{4}-\d{6}$/.test(inquiry?.ticketNumber ?? "") &&
      inquiry?.status === "SUBMITTED" &&
      inquiry?.statusHistory?.length === 1 &&
      inquiry?.statusHistory?.[0]?.fromStatus === null,
    `${inquiry?.ticketNumber} ${inquiry?.status}`
  );

  const emptySubject = await api("/api/inquiries", {
    method: "POST",
    token: idToken,
    body: { subject: "", message: "Hello" },
  });
  record(
    "POST inquiry without subject -> 400",
    emptySubject.status === 400,
    emptySubject.body?.message ?? `status ${emptySubject.status}`
  );

  const orderInquirySubmit = await api("/api/inquiries", {
    method: "POST",
    token: idToken,
    body: {
      subject: "Question regarding my order",
      message: "I would like to ask about this order's schedule.",
      relatedOrderId: order?.id,
    },
  });
  const orderInquiry = orderInquirySubmit.body?.data;
  record(
    "POST inquiry linked to own order -> 201 with order attached",
    orderInquirySubmit.status === 201 &&
      orderInquiry?.relatedOrder?.orderNumber === order?.orderNumber,
    `linked to ${orderInquiry?.relatedOrder?.orderNumber}`
  );

  const foreignOrderInquiry = await api("/api/inquiries", {
    method: "POST",
    token: idToken,
    body: {
      subject: "Sneaky link",
      message: "Trying to link an order that is not mine.",
      relatedOrderId: "00000000-0000-0000-0000-000000000000",
    },
  });
  record(
    "POST inquiry with foreign/unknown order -> 404 (ownership hidden)",
    foreignOrderInquiry.status === 404,
    foreignOrderInquiry.body?.message ?? `status ${foreignOrderInquiry.status}`
  );

  const myInquiries = await api("/api/inquiries/me", { token: idToken });
  record(
    "GET /api/inquiries/me -> 200 with own tickets",
    myInquiries.status === 200 && myInquiries.body?.count === 2,
    `count=${myInquiries.body?.count}`
  );

  const myInquiryDetail = await api(`/api/inquiries/me/${inquiry?.id}`, {
    token: idToken,
  });
  record(
    "GET /api/inquiries/me/:ticketId -> 200 with history",
    myInquiryDetail.status === 200 &&
      Array.isArray(myInquiryDetail.body?.data?.statusHistory),
    `${myInquiryDetail.body?.data?.ticketNumber}`
  );

  const unknownMyInquiry = await api(
    "/api/inquiries/me/00000000-0000-0000-0000-000000000000",
    { token: idToken }
  );
  record(
    "GET unknown ticket via /me -> 404",
    unknownMyInquiry.status === 404,
    unknownMyInquiry.body?.message ?? `status ${unknownMyInquiry.status}`
  );

  const farmerInquiryQueue = await api("/api/inquiries", { token: idToken });
  record(
    "GET /api/inquiries as farmer -> 403 (staff only)",
    farmerInquiryQueue.status === 403,
    farmerInquiryQueue.body?.message ?? `status ${farmerInquiryQueue.status}`
  );

  // Staff side.
  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const inquiryQueue = await api("/api/inquiries", { token: idToken });
  record(
    "GET /api/inquiries as staff -> 200 with pagination",
    inquiryQueue.status === 200 &&
      inquiryQueue.body?.pagination?.total >= 2 &&
      inquiryQueue.body?.data?.[0]?.customerProfile?.customerNumber !==
        undefined,
    `total=${inquiryQueue.body?.pagination?.total}`
  );

  const inquirySearch = await api(
    `/api/inquiries?search=${inquiry?.ticketNumber}`,
    { token: idToken }
  );
  record(
    "Search by ticket number finds the ticket",
    inquirySearch.status === 200 &&
      inquirySearch.body?.count === 1 &&
      inquirySearch.body?.data?.[0]?.id === inquiry?.id,
    `count=${inquirySearch.body?.count}`
  );

  const classify = await api(`/api/inquiries/${inquiry?.id}/classification`, {
    method: "PATCH",
    token: idToken,
    body: { category: "Parent Stock", priority: "High" },
  });
  record(
    "PATCH classification -> category + priority stored",
    classify.status === 200 &&
      classify.body?.data?.category === "Parent Stock" &&
      classify.body?.data?.priority === "High",
    `${classify.body?.data?.category} / ${classify.body?.data?.priority}`
  );

  const assign = await api(`/api/inquiries/${inquiry?.id}/assignment`, {
    method: "PATCH",
    token: idToken,
    body: { assignedToUserId: dacsUserId },
  });
  record(
    "PATCH assignment to staff -> 200 with assignedAt",
    assign.status === 200 &&
      assign.body?.data?.assignedToUserId === dacsUserId &&
      assign.body?.data?.assignedAt !== null,
    `assigned to self at ${String(assign.body?.data?.assignedAt).slice(0, 19)}`
  );

  const assignFarmer = await api(`/api/inquiries/${inquiry?.id}/assignment`, {
    method: "PATCH",
    token: idToken,
    body: { assignedToUserId: strangerUser.id },
  });
  record(
    "Assigning a CLIENT_FARMER -> 400 (invalid assignee)",
    assignFarmer.status === 400,
    assignFarmer.body?.message ?? `status ${assignFarmer.status}`
  );

  const underReview = await api(`/api/inquiries/${inquiry?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "UNDER_REVIEW", notes: "Being reviewed by staff." },
  });
  record(
    "PATCH status SUBMITTED -> UNDER_REVIEW with timestamp",
    underReview.status === 200 &&
      underReview.body?.data?.status === "UNDER_REVIEW" &&
      underReview.body?.data?.underReviewAt !== null,
    `status=${underReview.body?.data?.status}`
  );

  const respondedViaStatus = await api(`/api/inquiries/${inquiry?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "RESPONDED" },
  });
  record(
    "PATCH status RESPONDED directly -> 409 (must use email-response)",
    respondedViaStatus.status === 409,
    respondedViaStatus.body?.message ?? `status ${respondedViaStatus.status}`
  );

  const closeWithoutEmail = await api(`/api/inquiries/${inquiry?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "CLOSED" },
  });
  record(
    "PATCH status CLOSED before email response -> 409",
    closeWithoutEmail.status === 409,
    closeWithoutEmail.body?.message ?? `status ${closeWithoutEmail.status}`
  );

  const emailResponse = await api(
    `/api/inquiries/${inquiry?.id}/email-response`,
    {
      method: "PATCH",
      token: idToken,
      body: {
        emailResponseReference: "RE: Parent Stock schedule (msg-2026-08-14)",
        emailResponseNotes: "Replied with the September schedule via official email.",
      },
    }
  );
  record(
    "PATCH email-response -> RESPONDED with responder recorded",
    emailResponse.status === 200 &&
      emailResponse.body?.data?.status === "RESPONDED" &&
      emailResponse.body?.data?.emailRespondedAt !== null &&
      emailResponse.body?.data?.emailRespondedBy?.id === dacsUserId,
    `status=${emailResponse.body?.data?.status}`
  );

  const closeTicket = await api(`/api/inquiries/${inquiry?.id}/status`, {
    method: "PATCH",
    token: idToken,
    body: { status: "CLOSED", notes: "Inquiry fully handled." },
  });
  const closedHistory = (closeTicket.body?.data?.statusHistory ?? []).map(
    (entry: any) => entry.toStatus
  );
  record(
    "PATCH status CLOSED after email -> full history retained",
    closeTicket.status === 200 &&
      closeTicket.body?.data?.closedAt !== null &&
      JSON.stringify(closedHistory) ===
        JSON.stringify(["SUBMITTED", "UNDER_REVIEW", "RESPONDED", "CLOSED"]),
    closedHistory.join(" -> ")
  );

  const emailAfterClose = await api(
    `/api/inquiries/${inquiry?.id}/email-response`,
    { method: "PATCH", token: idToken, body: {} }
  );
  record(
    "Email response on a CLOSED ticket -> 409",
    emailAfterClose.status === 409,
    emailAfterClose.body?.message ?? `status ${emailAfterClose.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after inquiry tests", true);

  const inquiryLogs = await prisma.activityLog.findMany({
    where: { module: "INQUIRIES" },
    select: { action: true },
  });
  const requiredInquiryActions = [
    "INQUIRY_TICKET_CREATED",
    "INQUIRY_CLASSIFIED",
    "INQUIRY_ASSIGNED",
    "INQUIRY_STATUS_CHANGED",
    "INQUIRY_EMAIL_RESPONSE_RECORDED",
  ];
  const missingInquiryActions = requiredInquiryActions.filter(
    (action) => !inquiryLogs.some((log) => log.action === action)
  );
  record(
    "INQUIRIES activity logs recorded",
    missingInquiryActions.length === 0,
    missingInquiryActions.length
      ? `missing: ${missingInquiryActions.join(", ")}`
      : `${inquiryLogs.length} INQUIRIES entries`
  );

  // ---- 10i. FAQs (Requirement 9) --------------------------------------------
  // Role is CLIENT_FARMER. FAQs are pure content, so the cleanup can
  // clear the whole table.
  await prisma.faq.deleteMany({});

  const publicEmptyFaqs = await api("/api/faqs");
  record(
    "GET /api/faqs without any token -> 200 (public endpoint)",
    publicEmptyFaqs.status === 200 && publicEmptyFaqs.body?.count === 0,
    `count=${publicEmptyFaqs.body?.count}`
  );

  const farmerCreateFaq = await api("/api/faqs", {
    method: "POST",
    token: idToken,
    body: { question: "Hack?", answer: "Hack." },
  });
  record(
    "POST /api/faqs as farmer -> 403 (staff only)",
    farmerCreateFaq.status === 403,
    farmerCreateFaq.body?.message ?? `status ${farmerCreateFaq.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const faq1Create = await api("/api/faqs", {
    method: "POST",
    token: idToken,
    body: {
      category: "Ordering",
      question: "How do I order Parent Stock?",
      answer:
        "Complete Seminar Modules 1-3 first, then submit a Parent Stock order from your account.",
    },
  });
  const faq2Create = await api("/api/faqs", {
    method: "POST",
    token: idToken,
    body: {
      category: "Seminars",
      question: "How do I take the seminar quiz?",
      answer: "Open a published module, watch its videos, then take the quiz.",
    },
  });
  const faq1 = faq1Create.body?.data;
  const faq2 = faq2Create.body?.data;
  record(
    "POST two FAQs as staff -> 201 unpublished with creator + auto order",
    faq1Create.status === 201 &&
      faq2Create.status === 201 &&
      faq1?.isPublished === false &&
      faq1?.createdByUserId === dacsUserId &&
      faq1?.displayOrder === 1 &&
      faq2?.displayOrder === 2,
    `orders ${faq1?.displayOrder}, ${faq2?.displayOrder}`
  );

  const faqNoQuestion = await api("/api/faqs", {
    method: "POST",
    token: idToken,
    body: { answer: "An answer with no question." },
  });
  record(
    "POST FAQ without question -> 400",
    faqNoQuestion.status === 400,
    faqNoQuestion.body?.message ?? `status ${faqNoQuestion.status}`
  );

  const publicDrafts = await api("/api/faqs");
  record(
    "Unpublished FAQs hidden from the public list",
    publicDrafts.status === 200 && publicDrafts.body?.count === 0,
    `count=${publicDrafts.body?.count}`
  );

  const publishFaq1 = await api(`/api/faqs/${faq1?.id}/publish`, {
    method: "PATCH",
    token: idToken,
    body: { isPublished: true },
  });
  const publishFaq2 = await api(`/api/faqs/${faq2?.id}/publish`, {
    method: "PATCH",
    token: idToken,
    body: { isPublished: true },
  });
  const doublePublish = await api(`/api/faqs/${faq1?.id}/publish`, {
    method: "PATCH",
    token: idToken,
    body: { isPublished: true },
  });
  record(
    "PATCH publish both FAQs -> 200, publishing twice -> 409",
    publishFaq1.status === 200 &&
      publishFaq1.body?.data?.isPublished === true &&
      publishFaq2.status === 200 &&
      doublePublish.status === 409,
    `${publishFaq1.status}/${publishFaq2.status}, repeat=${doublePublish.status}`
  );

  const publicFaqs = await api("/api/faqs");
  record(
    "Public list shows published FAQs in display order",
    publicFaqs.status === 200 &&
      publicFaqs.body?.count === 2 &&
      publicFaqs.body?.data?.[0]?.id === faq1?.id,
    `count=${publicFaqs.body?.count}, first="${publicFaqs.body?.data?.[0]?.question}"`
  );

  const faqCategoryFilter = await api("/api/faqs?category=ordering");
  const faqSearch = await api("/api/faqs?search=quiz");
  record(
    "Public FAQ filters: category (case-insensitive) + search",
    faqCategoryFilter.body?.count === 1 &&
      faqCategoryFilter.body?.data?.[0]?.id === faq1?.id &&
      faqSearch.body?.count === 1 &&
      faqSearch.body?.data?.[0]?.id === faq2?.id,
    `category=${faqCategoryFilter.body?.count}, search=${faqSearch.body?.count}`
  );

  const editFaqAnswer = await api(`/api/faqs/${faq1?.id}`, {
    method: "PATCH",
    token: idToken,
    body: { answer: "Complete Seminar Modules 1-3, then order from the catalog." },
  });
  record(
    "PATCH FAQ answer -> 200 with editor recorded",
    editFaqAnswer.status === 200 &&
      editFaqAnswer.body?.data?.updatedByUserId === dacsUserId,
    `updatedBy=${editFaqAnswer.body?.data?.updatedByUserId === dacsUserId ? "staff" : "?"}`
  );

  const reorder = await api("/api/faqs/reorder", {
    method: "PATCH",
    token: idToken,
    body: { orderedFaqIds: [faq2?.id, faq1?.id] },
  });
  const reorderedPublic = await api("/api/faqs");
  record(
    "PATCH reorder -> FAQ 2 now first on the public list",
    reorder.status === 200 &&
      reorderedPublic.body?.data?.[0]?.id === faq2?.id &&
      reorderedPublic.body?.data?.[1]?.id === faq1?.id,
    `first="${reorderedPublic.body?.data?.[0]?.question}"`
  );

  const badReorder = await api("/api/faqs/reorder", {
    method: "PATCH",
    token: idToken,
    body: { orderedFaqIds: [faq1?.id] },
  });
  record(
    "Reorder list missing an FAQ -> 400",
    badReorder.status === 400,
    badReorder.body?.message ?? `status ${badReorder.status}`
  );

  const unpublishFaq2 = await api(`/api/faqs/${faq2?.id}/publish`, {
    method: "PATCH",
    token: idToken,
    body: { isPublished: false },
  });
  const afterUnpublish = await api("/api/faqs");
  record(
    "Unpublish -> FAQ disappears from the public list",
    unpublishFaq2.status === 200 && afterUnpublish.body?.count === 1,
    `public count=${afterUnpublish.body?.count}`
  );

  const manageList = await api("/api/faqs/manage?isPublished=false", {
    token: idToken,
  });
  record(
    "GET /api/faqs/manage as staff shows drafts with attribution",
    manageList.status === 200 &&
      manageList.body?.count === 1 &&
      manageList.body?.data?.[0]?.createdBy?.email !== undefined,
    `drafts=${manageList.body?.count}`
  );

  const deleteFaq2 = await api(`/api/faqs/${faq2?.id}`, {
    method: "DELETE",
    token: idToken,
  });
  const deleteAgain = await api(`/api/faqs/${faq2?.id}`, {
    method: "DELETE",
    token: idToken,
  });
  const badFaqId = await api("/api/faqs/hello", {
    method: "DELETE",
    token: idToken,
  });
  record(
    "DELETE FAQ -> 200, repeat -> 404, malformed ID -> 400",
    deleteFaq2.status === 200 &&
      deleteAgain.status === 404 &&
      badFaqId.status === 400,
    `${deleteFaq2.status} / ${deleteAgain.status} / ${badFaqId.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after FAQ tests", true);

  const faqLogs = await prisma.activityLog.findMany({
    where: { module: "FAQS" },
    select: { action: true },
  });
  const requiredFaqActions = [
    "FAQ_CREATED",
    "FAQ_UPDATED",
    "FAQ_PUBLISHED",
    "FAQ_UNPUBLISHED",
    "FAQ_REORDERED",
    "FAQ_DELETED",
  ];
  const missingFaqActions = requiredFaqActions.filter(
    (action) => !faqLogs.some((log) => log.action === action)
  );
  record(
    "FAQS activity logs recorded",
    missingFaqActions.length === 0,
    missingFaqActions.length
      ? `missing: ${missingFaqActions.join(", ")}`
      : `${faqLogs.length} FAQS entries`
  );

  // ---- 10j. Historical records (Requirement 10) -----------------------------
  // Role is CLIENT_FARMER. This section is hermetic: it builds its own
  // tiny workbook in memory and cleans its fixtures up afterwards — the
  // real Dominant Asia import is never touched.
  const IMPORT_TEST_EMAIL = "historical-import-test@dacs-test.example";
  const CLAIM_TEST_EMAIL = "historical-claim-test@dacs-test.example";
  const TEST_WORKBOOK_NAME = "suite-historical-test.xlsx";

  await prisma.historicalFile.deleteMany({
    where: { originalName: TEST_WORKBOOK_NAME },
  });
  await prisma.historicalSourceRecord.deleteMany({
    where: { sourceFilename: TEST_WORKBOOK_NAME },
  });
  await prisma.customerProfile.deleteMany({
    where: { contactEmail: { in: [IMPORT_TEST_EMAIL, CLAIM_TEST_EMAIL] } },
  });
  await prisma.user.deleteMany({ where: { email: CLAIM_TEST_EMAIL } });
  try {
    const staleClaimUser = await firebaseAuth!.getUserByEmail(CLAIM_TEST_EMAIL);
    await firebaseAuth!.deleteUser(staleClaimUser.uid);
  } catch {
    // no stale user
  }

  const testWorkbook = new ExcelJS.Workbook();
  const testSheet = testWorkbook.addWorksheet("Breeder Certificate Sheet");
  testSheet.addRow([
    "Email Address",
    "Name",
    "Address",
    "Facebook and Messenger Account Name",
    "Contact Numbers",
  ]);
  testSheet.addRow([
    IMPORT_TEST_EMAIL,
    "Testy H. Import",
    "123 Import Street, Tagbilaran City, Bohol",
    "Testy Import",
    "0917-000-1111",
  ]);
  testSheet.addRow([IMPORT_TEST_EMAIL, "Testy H. Import", "duplicate row", "", ""]);
  testSheet.addRow(["", "No Email Person", "incomplete row", "", ""]);
  const testWorkbookBuffer = Buffer.from(await testWorkbook.xlsx.writeBuffer());

  async function uploadHistorical(
    token: string | undefined,
    buffer: Buffer,
    filename: string
  ): Promise<{ status: number; body: any }> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      filename
    );
    form.append("category", "Suite Test");

    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${BASE_URL}/api/historical/files`, {
      method: "POST",
      headers,
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

  const farmerUpload = await uploadHistorical(
    idToken,
    testWorkbookBuffer,
    TEST_WORKBOOK_NAME
  );
  record(
    "POST /api/historical/files as farmer -> 403 (staff only)",
    farmerUpload.status === 403,
    farmerUpload.body?.message ?? `status ${farmerUpload.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const historicalUpload = await uploadHistorical(
    idToken,
    testWorkbookBuffer,
    TEST_WORKBOOK_NAME
  );
  const uploadSummary = historicalUpload.body?.data?.imports?.[0];
  const historicalFileId = historicalUpload.body?.data?.file?.id;
  // Lossless semantics: every row is preserved as a historical source
  // record (row 3 re-references the same customer with different cell
  // content — kept + linked, not dropped; row 4 lacks an email — kept
  // + flagged INVALID + import_errors row).
  record(
    "Upload + import workbook -> 1 customer, 3 source records, 1 error",
    historicalUpload.status === 201 &&
      uploadSummary?.rowsProcessed === 3 &&
      uploadSummary?.customersCreated === 1 &&
      uploadSummary?.duplicateRows === 0 &&
      uploadSummary?.errorRows === 1 &&
      uploadSummary?.sourceRecordsCreated === 3,
    `rows=${uploadSummary?.rowsProcessed} created=${uploadSummary?.customersCreated} dup=${uploadSummary?.duplicateRows} err=${uploadSummary?.errorRows} records=${uploadSummary?.sourceRecordsCreated}`
  );

  // Re-uploading the same workbook must be idempotent: every row's
  // content is already captured, so nothing new is created anywhere.
  const reUpload = await uploadHistorical(
    idToken,
    testWorkbookBuffer,
    TEST_WORKBOOK_NAME
  );
  const reUploadSummary = reUpload.body?.data?.imports?.[0];
  const secondFileId = reUpload.body?.data?.file?.id;
  record(
    "Re-upload same workbook -> 3 duplicates, nothing created",
    reUpload.status === 201 &&
      reUploadSummary?.rowsProcessed === 3 &&
      reUploadSummary?.customersCreated === 0 &&
      reUploadSummary?.duplicateRows === 3 &&
      reUploadSummary?.errorRows === 0 &&
      reUploadSummary?.sourceRecordsCreated === 0,
    `dup=${reUploadSummary?.duplicateRows} created=${reUploadSummary?.customersCreated} records=${reUploadSummary?.sourceRecordsCreated}`
  );
  if (secondFileId) {
    await api(`/api/historical/files/${secondFileId}`, {
      method: "DELETE",
      token: idToken,
    });
  }

  const importedSourceRecords = await prisma.historicalSourceRecord.findMany({
    where: { sourceFilename: TEST_WORKBOOK_NAME },
    orderBy: { rowNumber: "asc" },
  });
  const validRecord = importedSourceRecords.find(
    (entry) => entry.rowNumber === 2
  );
  const invalidRecord = importedSourceRecords.find(
    (entry) => entry.rowNumber === 4
  );
  record(
    "Source records preserve cells + flag identity failures",
    importedSourceRecords.length === 3 &&
      validRecord?.validationStatus === "VALID" &&
      validRecord?.customerProfileId !== null &&
      validRecord?.address === "123 Import Street, Tagbilaran City, Bohol" &&
      invalidRecord?.validationStatus === "INVALID" &&
      invalidRecord?.customerProfileId === null &&
      invalidRecord?.fullName === "No Email Person",
    `records=${importedSourceRecords.length} row2=${validRecord?.validationStatus} row4=${invalidRecord?.validationStatus}`
  );

  const importedProfile = await prisma.customerProfile.findFirst({
    where: { contactEmail: IMPORT_TEST_EMAIL },
  });
  record(
    "Imported customer has DAPG number and parsed name",
    importedProfile !== null &&
      /^DAPG-\d+$/.test(importedProfile?.customerNumber ?? "") &&
      importedProfile?.firstName === "Testy" &&
      importedProfile?.middleName === "H." &&
      importedProfile?.lastName === "Import" &&
      importedProfile?.userId === null,
    `${importedProfile?.customerNumber}: ${importedProfile?.firstName} ${importedProfile?.middleName} ${importedProfile?.lastName}`
  );

  const filesSearch = await api(
    "/api/historical/files?search=suite-historical",
    { token: idToken }
  );
  record(
    "GET /api/historical/files?search finds the uploaded file",
    filesSearch.status === 200 &&
      (filesSearch.body?.data ?? []).some(
        (entry: any) => entry.id === historicalFileId
      ),
    `count=${filesSearch.body?.count}`
  );

  const importErrors = await api(
    `/api/historical/imports/${uploadSummary?.importId}/errors`,
    { token: idToken }
  );
  const errorTypes = (importErrors.body?.data ?? []).map(
    (entry: any) => entry.errorType
  );
  record(
    "GET import errors -> INCOMPLETE identity failure with raw row data",
    importErrors.status === 200 &&
      importErrors.body?.count === 1 &&
      errorTypes.includes("INCOMPLETE") &&
      importErrors.body?.data?.[0]?.rawData !== undefined,
    errorTypes.join(", ")
  );

  const firstErrorId = importErrors.body?.data?.[0]?.id;
  const resolveCall = await api(`/api/historical/errors/${firstErrorId}/resolve`, {
    method: "PATCH",
    token: idToken,
    body: { notes: "Reviewed manually — row can be ignored." },
  });
  const resolveAgain = await api(`/api/historical/errors/${firstErrorId}/resolve`, {
    method: "PATCH",
    token: idToken,
    body: {},
  });
  record(
    "PATCH resolve import error -> 200, resolving again -> 409",
    resolveCall.status === 200 &&
      resolveCall.body?.data?.resolvedAt !== null &&
      resolveAgain.status === 409,
    `${resolveCall.status} then ${resolveAgain.status}`
  );

  const fakeSpreadsheet = await uploadHistorical(
    idToken,
    Buffer.from("this is not an excel file"),
    "not-a-spreadsheet.xlsx"
  );
  record(
    "Uploading a non-xlsx file -> 400 (magic bytes)",
    fakeSpreadsheet.status === 400,
    fakeSpreadsheet.body?.message ?? `status ${fakeSpreadsheet.status}`
  );

  // The Requirement 10 linking rule: a historical customer (userId null)
  // is claimed by a new Firebase account with the same email — no
  // duplicate profile, DAPG number preserved.
  const claimHistoricalProfile = await prisma.customerProfile.create({
    data: {
      customerNumber: "DAPG-77777",
      userId: null,
      firstName: "Historical",
      lastName: "Customer",
      contactEmail: CLAIM_TEST_EMAIL,
    },
  });

  const claimFirebaseUser = await firebaseAuth!.createUser({
    email: CLAIM_TEST_EMAIL,
    password: "ClaimTest1234!",
    emailVerified: true,
  });
  const claimCustomToken = await firebaseAuth!.createCustomToken(
    claimFirebaseUser.uid
  );
  const claimSignIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: claimCustomToken, returnSecureToken: true }),
    }
  );
  const claimToken = ((await claimSignIn.json()) as any).idToken;

  await api("/api/auth/sync", { method: "POST", token: claimToken });
  const claimCreate = await api("/api/customers/me", {
    method: "POST",
    token: claimToken,
    body: { firstName: "Clara", lastName: "Claimer" },
  });
  record(
    "New account with historical email claims DAPG-77777 (no duplicate)",
    (claimCreate.status === 200 || claimCreate.status === 201) &&
      claimCreate.body?.data?.customerNumber === "DAPG-77777",
    `customerNumber=${claimCreate.body?.data?.customerNumber}`
  );

  const claimProfileCount = await prisma.customerProfile.count({
    where: { contactEmail: CLAIM_TEST_EMAIL },
  });
  record(
    "Exactly one profile exists for the claimed email",
    claimProfileCount === 1,
    `profiles=${claimProfileCount}`
  );

  // Claim-test cleanup.
  await prisma.customerProfile.delete({ where: { id: claimHistoricalProfile.id } });
  await prisma.user.deleteMany({ where: { email: CLAIM_TEST_EMAIL } });
  await firebaseAuth!.deleteUser(claimFirebaseUser.uid);

  const deleteHistorical = await api(`/api/historical/files/${historicalFileId}`, {
    method: "DELETE",
    token: idToken,
  });
  const retainedProfile = await prisma.customerProfile.findFirst({
    where: { contactEmail: IMPORT_TEST_EMAIL },
    select: { id: true, sourceImportId: true },
  });
  const retainedRecords = await prisma.historicalSourceRecord.findMany({
    where: { sourceFilename: TEST_WORKBOOK_NAME },
    select: { importId: true },
  });
  record(
    "DELETE historical file -> customers + source records retained (provenance nulled)",
    deleteHistorical.status === 200 &&
      retainedProfile !== null &&
      retainedProfile?.sourceImportId === null &&
      retainedRecords.length === 3 &&
      retainedRecords.every((entry) => entry.importId === null),
    `profile kept=${retainedProfile !== null} records kept=${retainedRecords.length}`
  );

  await prisma.historicalSourceRecord.deleteMany({
    where: { sourceFilename: TEST_WORKBOOK_NAME },
  });
  await prisma.customerProfile.deleteMany({
    where: { contactEmail: IMPORT_TEST_EMAIL },
  });

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after historical tests", true);

  const historicalLogs = await prisma.activityLog.findMany({
    where: { module: "HISTORICAL" },
    select: { action: true },
  });
  const linkedLog = await prisma.activityLog.findFirst({
    where: { module: "CUSTOMERS", action: "CUSTOMER_PROFILE_LINKED" },
  });
  const requiredHistoricalActions = [
    "HISTORICAL_FILE_UPLOADED",
    "HISTORICAL_IMPORT_COMPLETED",
    "IMPORT_ERROR_RESOLVED",
    "HISTORICAL_FILE_DELETED",
  ];
  const missingHistoricalActions = requiredHistoricalActions.filter(
    (action) => !historicalLogs.some((log) => log.action === action)
  );
  record(
    "HISTORICAL activity logs + CUSTOMER_PROFILE_LINKED recorded",
    missingHistoricalActions.length === 0 && linkedLog !== null,
    missingHistoricalActions.length
      ? `missing: ${missingHistoricalActions.join(", ")}`
      : `${historicalLogs.length} HISTORICAL entries + linked log`
  );

  // ---- 10k. Notifications (Requirement 12) ----------------------------------
  // State: role CLIENT_FARMER. Earlier sections already generated
  // farmer-side notifications for the test user: CERTIFICATE_APPROVED
  // (seminar approval in 10f, breeder certificate in 10g),
  // CERTIFICATE_EXPIRED (expiry flip in 10g), and NEW_CUSTOMER (the
  // claim flow in 10j notified staff, which the test user was then).

  const NOTIF_STAFF_EMAIL = "notification-staff-fixture@dacs-test.example";
  const notifStaff = await prisma.user.create({
    data: {
      firebaseUid: `notif-staff-${Date.now()}`,
      email: NOTIF_STAFF_EMAIL,
      role: "ADMINISTRATIVE_STAFF",
      status: "ACTIVE",
    },
  });

  const notifOrderSubmit = await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: f1ProductId, quantity: 1 }],
    },
  });
  const notifOrder = notifOrderSubmit.body?.data;
  const staffOrderNotif = await prisma.notification.findFirst({
    where: { userId: notifStaff.id, type: "NEW_ORDER" },
  });
  record(
    "New order generates a NEW_ORDER notification for staff",
    notifOrderSubmit.status === 201 &&
      staffOrderNotif !== null &&
      (staffOrderNotif?.message ?? "").includes(notifOrder?.orderNumber),
    staffOrderNotif?.message ?? "no notification found"
  );

  const notifTicketSubmit = await api("/api/inquiries", {
    method: "POST",
    token: idToken,
    body: {
      subject: "Notification test inquiry",
      message: "Checking that staff hear about new tickets.",
    },
  });
  const staffTicketNotif = await prisma.notification.findFirst({
    where: { userId: notifStaff.id, type: "NEW_TICKET" },
  });
  record(
    "New ticket generates a NEW_TICKET notification for staff",
    notifTicketSubmit.status === 201 && staffTicketNotif !== null,
    staffTicketNotif?.message ?? "no notification found"
  );

  const myNotifications = await api("/api/notifications", { token: idToken });
  const myNotifTypes = new Set(
    (myNotifications.body?.data ?? []).map((entry: any) => entry.type)
  );
  record(
    "GET /api/notifications -> certificate + customer notifications from earlier sections",
    myNotifications.status === 200 &&
      myNotifTypes.has("CERTIFICATE_APPROVED") &&
      myNotifTypes.has("CERTIFICATE_EXPIRED") &&
      myNotifTypes.has("NEW_CUSTOMER"),
    `types=${[...myNotifTypes].join(", ")}`
  );

  const unreadBefore = await api("/api/notifications/unread-count", {
    token: idToken,
  });
  record(
    "GET /api/notifications/unread-count -> matches total (nothing read yet)",
    unreadBefore.status === 200 &&
      unreadBefore.body?.count === myNotifications.body?.total,
    `unread=${unreadBefore.body?.count} total=${myNotifications.body?.total}`
  );

  const firstNotifId = myNotifications.body?.data?.[0]?.id;
  const markRead = await api(`/api/notifications/${firstNotifId}/read`, {
    method: "PATCH",
    token: idToken,
  });
  const markReadAgain = await api(`/api/notifications/${firstNotifId}/read`, {
    method: "PATCH",
    token: idToken,
  });
  record(
    "PATCH /:id/read -> 200 with readAt, repeat -> 409",
    markRead.status === 200 &&
      markRead.body?.data?.readAt !== null &&
      markReadAgain.status === 409,
    `readAt=${markRead.body?.data?.readAt}`
  );

  const foreignNotif = await api(
    "/api/notifications/00000000-0000-0000-0000-000000000000/read",
    { method: "PATCH", token: idToken }
  );
  record(
    "PATCH read on unknown notification -> 404",
    foreignNotif.status === 404,
    foreignNotif.body?.message ?? `status ${foreignNotif.status}`
  );

  const unreadAfterOne = await api("/api/notifications/unread-count", {
    token: idToken,
  });
  record(
    "Unread count drops by one after marking one read",
    unreadAfterOne.status === 200 &&
      unreadAfterOne.body?.count === unreadBefore.body?.count - 1,
    `unread=${unreadAfterOne.body?.count}`
  );

  const readAll = await api("/api/notifications/read-all", {
    method: "PATCH",
    token: idToken,
  });
  const unreadAfterAll = await api("/api/notifications/unread-count", {
    token: idToken,
  });
  record(
    "PATCH /read-all -> remaining marked, unread count 0",
    readAll.status === 200 &&
      readAll.body?.markedRead === unreadBefore.body?.count - 1 &&
      unreadAfterAll.body?.count === 0,
    `markedRead=${readAll.body?.markedRead}`
  );

  const preferencesDefault = await api("/api/notifications/preferences", {
    token: idToken,
  });
  const allEnabled = (preferencesDefault.body?.data ?? []).every(
    (preference: any) => preference.enabled === true
  );
  record(
    "GET /preferences -> all 6 types enabled by default",
    preferencesDefault.status === 200 &&
      preferencesDefault.body?.data?.length === 6 &&
      allEnabled,
    `types=${preferencesDefault.body?.data?.length} allEnabled=${allEnabled}`
  );

  const invalidPreference = await api("/api/notifications/preferences", {
    method: "PATCH",
    token: idToken,
    body: { preferences: [{ type: "MYSTERY_TYPE", enabled: false }] },
  });
  record(
    "PATCH preferences with invalid type -> 400",
    invalidPreference.status === 400,
    invalidPreference.body?.message ?? `status ${invalidPreference.status}`
  );

  const disablePreference = await api("/api/notifications/preferences", {
    method: "PATCH",
    token: idToken,
    body: { preferences: [{ type: "NEW_CUSTOMER", enabled: false }] },
  });
  const disabledEntry = (disablePreference.body?.data ?? []).find(
    (preference: any) => preference.type === "NEW_CUSTOMER"
  );
  record(
    "PATCH preferences disables NEW_CUSTOMER, others stay enabled",
    disablePreference.status === 200 &&
      disabledEntry?.enabled === false &&
      (disablePreference.body?.data ?? []).filter(
        (preference: any) => preference.enabled
      ).length === 5,
    `NEW_CUSTOMER=${disabledEntry?.enabled}`
  );

  // A disabled preference suppresses generation: opt the staff fixture
  // out of NEW_ORDER, then submit another order.
  await prisma.notificationPreference.create({
    data: { userId: notifStaff.id, type: "NEW_ORDER", enabled: false },
  });
  await api("/api/orders", {
    method: "POST",
    token: idToken,
    body: {
      orderType: "F1",
      fulfillmentMethod: "PICKUP",
      pickupBranch: "Dominant Asia",
      items: [{ productId: f1ProductId, quantity: 1 }],
    },
  });
  const staffOrderNotifCount = await prisma.notification.count({
    where: { userId: notifStaff.id, type: "NEW_ORDER" },
  });
  record(
    "Disabled preference suppresses new NEW_ORDER notifications",
    staffOrderNotifCount === 1,
    `NEW_ORDER notifications for fixture=${staffOrderNotifCount}`
  );

  const notificationLogs = await prisma.activityLog.findMany({
    where: { module: "NOTIFICATIONS" },
    select: { action: true },
  });
  record(
    "NOTIFICATIONS activity logs recorded (preference updates)",
    notificationLogs.some(
      (log) => log.action === "NOTIFICATION_PREFERENCES_UPDATED"
    ),
    `${notificationLogs.length} NOTIFICATIONS entries`
  );

  // Section cleanup: the fixture user cascades its notifications and
  // preferences; the test user's own preference row is reset so the
  // defaults test stays true on the next run.
  await prisma.user.delete({ where: { id: notifStaff.id } });
  await prisma.notificationPreference.deleteMany({
    where: { userId: dacsUserId },
  });
  record("Notification fixtures cleaned up", true);

  // ---- 10l. Analytics & reports (Requirement 11) ----------------------------
  // State: role CLIENT_FARMER. Every value must be computed live from
  // the data earlier sections created (plus the 1,500-customer real
  // migration already in the database).

  const farmerAnalytics = await api("/api/analytics/dashboard", {
    token: idToken,
  });
  record(
    "GET /api/analytics/dashboard as farmer -> 403 (staff only)",
    farmerAnalytics.status === 403,
    farmerAnalytics.body?.message ?? `status ${farmerAnalytics.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const dashboardResponse = await api("/api/analytics/dashboard", {
    token: idToken,
  });
  const dashboardData = dashboardResponse.body?.data;
  // KPI totals must equal live database counts (same definitions the
  // analytics service uses) — exact, and independent of how much data
  // the surrounding database holds, so the suite runs on a fresh test
  // database as well as one carrying the historical import.
  const [expectedKpiCustomers, expectedKpiFarms] = await Promise.all([
    prisma.customerProfile.count({ where: { archivedAt: null } }),
    prisma.farm.count({ where: { archivedAt: null } }),
  ]);
  record(
    "GET /dashboard -> KPIs computed live (match direct DB counts)",
    dashboardResponse.status === 200 &&
      dashboardData?.kpis?.totalCustomers === expectedKpiCustomers &&
      dashboardData?.kpis?.totalFarms === expectedKpiFarms &&
      dashboardData?.kpis?.totalOrders >= 5,
    `customers=${dashboardData?.kpis?.totalCustomers}/${expectedKpiCustomers} farms=${dashboardData?.kpis?.totalFarms}/${expectedKpiFarms} orders=${dashboardData?.kpis?.totalOrders}`
  );

  const f1Sales = (dashboardData?.kpis?.salesByType ?? []).find(
    (entry: any) => entry.orderType === "F1"
  );
  record(
    "Dashboard sales KPIs: paid F1 order counted with revenue",
    f1Sales !== undefined && f1Sales.sales >= 1 && f1Sales.revenue >= 3000,
    `F1 sales=${f1Sales?.sales} revenue=${f1Sales?.revenue}`
  );

  record(
    "Dashboard charts: monthly sales series + breeder status present",
    Array.isArray(dashboardData?.charts?.salesPerMonth) &&
      dashboardData.charts.salesPerMonth.length >= 1 &&
      (dashboardData?.charts?.breederStatus ?? []).some(
        (entry: any) => entry.status === "EXPIRED" && entry.count >= 1
      ),
    `months=${dashboardData?.charts?.salesPerMonth?.length} breederStatus=${JSON.stringify(dashboardData?.charts?.breederStatus)}`
  );

  const f1Only = await api("/api/analytics/orders?orderType=F1", {
    token: idToken,
  });
  const f1OnlyTypes = (f1Only.body?.data?.byType ?? []).map(
    (entry: any) => entry.orderType
  );
  record(
    "Category filter: /orders?orderType=F1 returns only F1 rows",
    f1Only.status === 200 &&
      f1OnlyTypes.length === 1 &&
      f1OnlyTypes[0] === "F1" &&
      f1Only.body?.data?.totals?.orders >= 3,
    `types=${f1OnlyTypes.join(",")} orders=${f1Only.body?.data?.totals?.orders}`
  );

  const emptyRange = await api(
    "/api/analytics/orders?from=2000-01-01&to=2000-12-31",
    { token: idToken }
  );
  record(
    "Date filter: year-2000 range -> zero orders",
    emptyRange.status === 200 && emptyRange.body?.data?.totals?.orders === 0,
    `orders=${emptyRange.body?.data?.totals?.orders}`
  );

  const badDate = await api("/api/analytics/orders?from=2026-99-99", {
    token: idToken,
  });
  const badType = await api("/api/analytics/orders?orderType=BANANAS", {
    token: idToken,
  });
  record(
    "Invalid date -> 400, invalid orderType -> 400",
    badDate.status === 400 && badType.status === 400,
    `${badDate.body?.message} / ${badType.body?.message}`
  );

  const paymentStats = await api("/api/analytics/payments", { token: idToken });
  const verifiedRow = (paymentStats.body?.data?.byStatus ?? []).find(
    (entry: any) => entry.status === "VERIFIED"
  );
  record(
    "Payment KPIs: VERIFIED count + amount aggregated",
    paymentStats.status === 200 &&
      verifiedRow?.count >= 2 &&
      verifiedRow?.amount >= 3000,
    `verified=${verifiedRow?.count} amount=${verifiedRow?.amount}`
  );

  const seminarStats = await api("/api/analytics/seminars", { token: idToken });
  const module1 = (seminarStats.body?.data?.byModule ?? []).find(
    (entry: any) => entry.moduleNumber === 1
  );
  record(
    "Seminar KPIs: per-module completion + quiz pass rate + certificates",
    seminarStats.status === 200 &&
      module1?.enrolled >= 1 &&
      module1?.completed >= 1 &&
      module1?.completionRate === 100 &&
      seminarStats.body?.data?.quiz?.attempts >= 2 &&
      (seminarStats.body?.data?.certificates ?? []).some(
        (entry: any) => entry.status === "APPROVED" && entry.count >= 1
      ),
    `module1=${module1?.completed}/${module1?.enrolled} quizPass=${seminarStats.body?.data?.quiz?.passRate}%`
  );

  const breederStats = await api("/api/analytics/breeders", { token: idToken });
  const breederRegions = breederStats.body?.data?.byRegion ?? [];
  record(
    "Breeder KPIs: date-aware status distribution + regional summary",
    breederStats.status === 200 &&
      (breederStats.body?.data?.statusDistribution ?? []).some(
        (entry: any) => entry.status === "EXPIRED" && entry.count >= 1
      ) &&
      breederRegions.length >= 1 &&
      breederRegions[0]?.total >= 1,
    `regions=${breederRegions.length} first=${breederRegions[0]?.region}/${breederRegions[0]?.province}`
  );

  const breederNowhere = await api(
    "/api/analytics/breeders?region=Atlantis",
    { token: idToken }
  );
  record(
    "Breeder regional filter: unknown region -> empty distribution",
    breederNowhere.status === 200 &&
      (breederNowhere.body?.data?.statusDistribution ?? []).length === 0,
    `rows=${(breederNowhere.body?.data?.statusDistribution ?? []).length}`
  );

  const inquiryStats = await api("/api/analytics/inquiries", {
    token: idToken,
  });
  record(
    "Inquiry KPIs: status breakdown, monthly volume, avg response time",
    inquiryStats.status === 200 &&
      (inquiryStats.body?.data?.byStatus ?? []).some(
        (entry: any) => entry.status === "CLOSED" && entry.count >= 1
      ) &&
      (inquiryStats.body?.data?.perMonth ?? []).length >= 1 &&
      typeof inquiryStats.body?.data?.averageResponseHours === "number",
    `avgResponseHours=${inquiryStats.body?.data?.averageResponseHours}`
  );

  const customerStats = await api("/api/analytics/customers", {
    token: idToken,
  });
  // Same environment-independent treatment: compare against the exact
  // service definitions instead of the dev database's historical scale.
  const [expectedActiveCustomers, expectedUnclaimed] = await Promise.all([
    prisma.customerProfile.count({ where: { archivedAt: null } }),
    prisma.customerProfile.count({
      where: { archivedAt: null, userId: null },
    }),
  ]);
  record(
    "Customer KPIs: totals + unclaimed historical + farm regional summary",
    customerStats.status === 200 &&
      customerStats.body?.data?.totals?.activeCustomers ===
        expectedActiveCustomers &&
      customerStats.body?.data?.totals?.unclaimedHistorical ===
        expectedUnclaimed &&
      (customerStats.body?.data?.farmsByRegion ?? []).length >= 1,
    `active=${customerStats.body?.data?.totals?.activeCustomers}/${expectedActiveCustomers} unclaimed=${customerStats.body?.data?.totals?.unclaimedHistorical}/${expectedUnclaimed}`
  );

  // CSV export goes through raw fetch — the api() helper only parses
  // JSON bodies.
  const csvResponse = await fetch(`${BASE_URL}/api/analytics/export?report=orders`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const csvText = await csvResponse.text();
  record(
    "GET /export?report=orders -> CSV download with real order rows",
    csvResponse.status === 200 &&
      (csvResponse.headers.get("content-type") ?? "").includes("text/csv") &&
      csvText.startsWith("orderNumber,") &&
      csvText.includes("OQ-F1-2026-001"),
    `${csvText.split("\r\n")[0]?.slice(0, 60)}...`
  );

  const badReport = await api("/api/analytics/export?report=everything", {
    token: idToken,
  });
  record(
    "GET /export with unknown report -> 400",
    badReport.status === 400,
    badReport.body?.message ?? `status ${badReport.status}`
  );

  await prisma.user.update({
    where: { id: dacsUserId },
    data: { role: "CLIENT_FARMER" },
  });
  record("Role restored after analytics tests", true);

  // ---- 11. Activity logs ----------------------------------------------------
  const logs = await prisma.activityLog.findMany({
    where: { userId: dacsUserId },
    orderBy: { createdAt: "asc" },
    select: { module: true, action: true, outcome: true },
  });
  const actions = [...new Set(logs.map((log) => log.action))];
  const expectedActions = [
    "CUSTOMER_PROFILE_CREATED",
    "CUSTOMER_PROFILE_UPDATED",
    "CUSTOMER_PROFILE_ARCHIVED",
    "FARM_CREATED",
    "FARM_UPDATED",
    "FARM_ARCHIVED",
  ];
  const missingActions = expectedActions.filter(
    (action) => !actions.includes(action)
  );
  record(
    "Activity logs recorded for all modules",
    logs.length > 0 && missingActions.length === 0,
    missingActions.length
      ? `missing: ${missingActions.join(", ")}`
      : `${logs.length} entries: ${actions.join(", ")}`
  );

  // ---- 12. Clean up test fixtures -------------------------------------------
  await prisma.farm.deleteMany({
    where: { customerProfileId: strangerProfile.id },
  });
  await prisma.customerProfile.delete({ where: { id: strangerProfile.id } });
  await prisma.user.delete({ where: { id: strangerUser.id } });
  record("Ownership-test fixtures cleaned up", true);

  return finish();
}

function finish(): void {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  console.log(`\n========================================`);
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`========================================\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Smoke test crashed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
