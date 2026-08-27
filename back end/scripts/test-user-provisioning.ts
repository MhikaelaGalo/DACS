/**
 * User pre-authorization / provisioning verification (Add User flow).
 *
 * Covers the POST /api/users pre-authorization model end to end:
 *   - Owner creates a user row from a Google email (no Firebase
 *     identity yet, no password of any kind)
 *   - RBAC: only Owners may create; staff/farmers get 403
 *   - validation: bad email/role/unexpected fields -> 400; dup -> 409
 *   - first verified sign-in links the Firebase identity to the row
 *     and keeps the pre-assigned role (never resets to farmer)
 *   - unverified emails cannot claim a pre-authorized row
 *   - unknown (non-pre-authorized) accounts sync as CLIENT_FARMER and
 *     are denied every staff endpoint
 *   - disabling a linked user blocks access even with valid tokens
 *
 * Prerequisites: backend on :5000, staff seeded (seed-staff-users.ts).
 * Run: npx tsx scripts/test-user-provisioning.ts
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

const LINK_EMAIL = "dacs.provision.link@dacs-test.example";
const UNVERIFIED_EMAIL = "dacs.provision.unverified@dacs-test.example";
const STRANGER_EMAIL = "dacs.provision.stranger@dacs-test.example";

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

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

async function cleanupFixtures(): Promise<void> {
  if (!firebaseAuth) return;
  for (const email of [LINK_EMAIL, UNVERIFIED_EMAIL, STRANGER_EMAIL]) {
    await prisma.user.deleteMany({ where: { email } });
    try {
      const user = await firebaseAuth.getUserByEmail(email);
      await firebaseAuth.deleteUser(user.uid);
    } catch {
      /* no such Firebase user */
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nUser provisioning verification against ${BASE_URL}\n`);
  await assertTestServer();
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");

  const apiKey = await getWebApiKey();
  await cleanupFixtures();

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

  // ---- RBAC: who may create users -----------------------------------------
  const asAdmin = await api("/api/users", {
    method: "POST",
    token: adminStaff,
    body: { email: LINK_EMAIL, role: "ADMINISTRATIVE_STAFF" },
  });
  record("POST /api/users (admin staff) -> 403", asAdmin.status === 403);

  const noToken = await api("/api/users", {
    method: "POST",
    body: { email: LINK_EMAIL, role: "ADMINISTRATIVE_STAFF" },
  });
  record("POST /api/users (no token) -> 401", noToken.status === 401);

  // ---- Validation ---------------------------------------------------------
  const badEmail = await api("/api/users", {
    method: "POST",
    token: owner,
    body: { email: "not-an-email", role: "IT_STAFF" },
  });
  record("POST /api/users bad email -> 400", badEmail.status === 400);

  const badRole = await api("/api/users", {
    method: "POST",
    token: owner,
    body: { email: LINK_EMAIL, role: "SUPER_ADMIN" },
  });
  record("POST /api/users invalid role -> 400", badRole.status === 400);

  const sneakyField = await api("/api/users", {
    method: "POST",
    token: owner,
    body: { email: LINK_EMAIL, role: "IT_STAFF", status: "ACTIVE" },
  });
  record(
    "POST /api/users unexpected field -> 400",
    sneakyField.status === 400,
    sneakyField.body?.message
  );

  // ---- Owner pre-authorizes a staff email ---------------------------------
  const created = await api("/api/users", {
    method: "POST",
    token: owner,
    body: {
      firstName: "Provision",
      lastName: "Fixture",
      email: LINK_EMAIL.toUpperCase(),
      phoneNumber: "09123456789",
      role: "ADMINISTRATIVE_STAFF",
    },
  });
  record(
    "POST /api/users (owner) -> 201, normalized email, ACTIVE",
    created.status === 201 &&
      created.body?.data?.email === LINK_EMAIL &&
      created.body?.data?.status === "ACTIVE" &&
      created.body?.data?.displayName === "Provision Fixture",
    `status ${created.status}`
  );

  const rowBefore = await prisma.user.findUnique({ where: { email: LINK_EMAIL } });
  record(
    "Pre-authorized row exists with NULL firebaseUid",
    rowBefore !== null && rowBefore.firebaseUid === null,
    `firebaseUid=${String(rowBefore?.firebaseUid)}`
  );

  const duplicate = await api("/api/users", {
    method: "POST",
    token: owner,
    body: { email: LINK_EMAIL, role: "IT_STAFF" },
  });
  record(
    "Duplicate email -> 409",
    duplicate.status === 409,
    duplicate.body?.message
  );

  // ---- First verified sign-in links the identity --------------------------
  const linkFirebase = await firebaseAuth.createUser({
    email: LINK_EMAIL,
    emailVerified: true,
    displayName: "Provision Fixture (Google)",
  });
  const linkToken = await mintIdToken(apiKey, linkFirebase.uid);
  const linkSync = await api("/api/auth/sync", { method: "POST", token: linkToken });
  record(
    "First sign-in links pre-authorized row (200, not created)",
    linkSync.status === 200 && linkSync.body?.data?.id === rowBefore?.id,
    `status ${linkSync.status}`
  );

  const linkedMe = await api("/api/auth/me", { token: linkToken });
  record(
    "Linked account keeps pre-assigned role",
    linkedMe.status === 200 && linkedMe.body?.data?.role === "ADMINISTRATIVE_STAFF",
    `role ${linkedMe.body?.data?.role}`
  );

  const rowAfter = await prisma.user.findUnique({ where: { email: LINK_EMAIL } });
  record(
    "Row now carries the Firebase UID + Google display name",
    rowAfter?.firebaseUid === linkFirebase.uid &&
      rowAfter?.displayName === "Provision Fixture (Google)",
    `displayName=${rowAfter?.displayName}`
  );

  const linkedAccess = await api("/api/historical/files", { token: linkToken });
  record(
    "Linked ADMINISTRATIVE_STAFF can use staff endpoints",
    linkedAccess.status === 200
  );

  // ---- Unverified emails cannot claim a pre-authorized row ----------------
  const preUnverified = await api("/api/users", {
    method: "POST",
    token: owner,
    body: { email: UNVERIFIED_EMAIL, role: "IT_STAFF" },
  });
  record("Pre-authorize second fixture -> 201", preUnverified.status === 201);

  const unverifiedFirebase = await firebaseAuth.createUser({
    email: UNVERIFIED_EMAIL,
    emailVerified: false,
    password: "Fixture1234!",
  });
  const unverifiedToken = await mintIdToken(apiKey, unverifiedFirebase.uid);
  const unverifiedSync = await api("/api/auth/sync", {
    method: "POST",
    token: unverifiedToken,
  });
  record(
    "Unverified email cannot claim pre-authorized row -> 403",
    unverifiedSync.status === 403,
    unverifiedSync.body?.message
  );

  // ---- Unknown accounts never gain staff access ---------------------------
  const strangerFirebase = await firebaseAuth.createUser({
    email: STRANGER_EMAIL,
    emailVerified: true,
  });
  const strangerToken = await mintIdToken(apiKey, strangerFirebase.uid);
  const strangerSync = await api("/api/auth/sync", {
    method: "POST",
    token: strangerToken,
  });
  record(
    "Unknown account syncs as CLIENT_FARMER",
    strangerSync.status === 201 && strangerSync.body?.data?.role === "CLIENT_FARMER",
    `role ${strangerSync.body?.data?.role}`
  );
  const strangerUsers = await api("/api/users", { token: strangerToken });
  const strangerHistorical = await api("/api/historical/files", {
    token: strangerToken,
  });
  record(
    "Unknown account denied every staff endpoint -> 403",
    strangerUsers.status === 403 && strangerHistorical.status === 403
  );

  // ---- Disabled users are blocked even with valid tokens ------------------
  const disable = await api(`/api/users/${rowAfter?.id}/status`, {
    method: "PATCH",
    token: owner,
    body: { status: "DISABLED" },
  });
  record("Owner disables the linked fixture -> 200", disable.status === 200);
  const disabledMe = await api("/api/auth/me", { token: linkToken });
  record(
    "Disabled account blocked despite valid token -> 403",
    disabledMe.status === 403,
    disabledMe.body?.message
  );

  await cleanupFixtures();
  record("Fixtures cleaned up", true);

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
  await cleanupFixtures().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
