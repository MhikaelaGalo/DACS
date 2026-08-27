/**
 * Admin-integration RBAC verification.
 *
 * Signs in as each seeded staff account with its real password (the
 * exact flow the admin frontend uses: identitytoolkit
 * signInWithPassword -> Bearer ID token) plus the farmer test user via
 * a minted custom token, then verifies the backend authorization
 * matrix that the admin frontend depends on:
 *
 *   - GET /api/auth/me         -> every ACTIVE user, correct role
 *   - GET /api/users           -> OWNER + IT only (viewUsers)
 *   - GET /api/historical/files-> OWNER + ADMINISTRATIVE_STAFF only
 *   - missing / garbage tokens -> 401
 *   - self status change       -> 403 (owner cannot disable self)
 *
 * Prerequisites: backend running on :5000, staff users seeded via
 * scripts/seed-staff-users.ts. Run: npx tsx scripts/test-admin-rbac.ts
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const CREDENTIALS_FILE =
  "C:/Users/Ella Ignacio/DACS-secrets/admin-staff-credentials.txt";
const PROJECT_ID = "dacs-8f430";
/* Synthetic fixture — lemonyfroggo@gmail.com is the dev Owner now. */
const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";

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
  if (!body.idToken) {
    throw new Error(`Password sign-in failed for ${email}: ${body.error?.message}`);
  }
  return body.idToken;
}

async function mintFarmerToken(apiKey: string): Promise<string> {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  let farmer;
  try {
    farmer = await firebaseAuth.getUserByEmail(FARMER_EMAIL);
  } catch {
    farmer = await firebaseAuth.createUser({
      email: FARMER_EMAIL,
      emailVerified: true,
      displayName: "DACS Backend Test User",
    });
  }
  const customToken = await firebaseAuth.createCustomToken(farmer.uid);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const body = (await response.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("Could not mint farmer ID token.");
  return body.idToken;
}

function loadPassword(email: string): string {
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (match && match[1].toLowerCase() === email.toLowerCase()) return match[2];
  }
  throw new Error(`No password for ${email} in ${CREDENTIALS_FILE}`);
}

async function main(): Promise<void> {
  console.log(`\nAdmin RBAC verification against ${BASE_URL}\n`);
  await assertTestServer();

  const apiKey = await getWebApiKey();
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
  const farmer = await mintFarmerToken(apiKey);

  /* Every account must sync before loadDacsUser-protected routes. */
  for (const [label, token] of [
    ["owner", owner],
    ["admin staff", adminStaff],
    ["IT staff", itStaff],
    ["farmer", farmer],
  ] as const) {
    const sync = await api("/api/auth/sync", { method: "POST", token });
    record(`POST /api/auth/sync (${label})`, sync.status === 200 || sync.status === 201);
  }

  // ---- GET /api/auth/me: identity + role ----------------------------------
  const meChecks = [
    { label: "owner", token: owner, role: "OWNER_EXECUTIVE" },
    { label: "admin staff", token: adminStaff, role: "ADMINISTRATIVE_STAFF" },
    { label: "IT staff", token: itStaff, role: "IT_STAFF" },
    { label: "farmer", token: farmer, role: "CLIENT_FARMER" },
  ];
  for (const check of meChecks) {
    const me = await api("/api/auth/me", { token: check.token });
    record(
      `GET /api/auth/me (${check.label}) -> ${check.role}`,
      me.status === 200 && me.body?.data?.role === check.role,
      `status ${me.status}, role ${me.body?.data?.role}`
    );
  }

  // ---- GET /api/users: OWNER + IT only ------------------------------------
  const usersOwner = await api("/api/users", { token: owner });
  record(
    "GET /api/users (owner) -> 200",
    usersOwner.status === 200 && Array.isArray(usersOwner.body?.data),
    `status ${usersOwner.status}, count ${usersOwner.body?.data?.length}`
  );
  const usersIt = await api("/api/users", { token: itStaff });
  record("GET /api/users (IT staff) -> 200", usersIt.status === 200);
  const usersAdmin = await api("/api/users", { token: adminStaff });
  record(
    "GET /api/users (admin staff) -> 403",
    usersAdmin.status === 403,
    `status ${usersAdmin.status}`
  );
  const usersFarmer = await api("/api/users", { token: farmer });
  record("GET /api/users (farmer) -> 403", usersFarmer.status === 403);

  // ---- GET /api/historical/files: OWNER + ADMIN only ----------------------
  const histOwner = await api("/api/historical/files", { token: owner });
  record(
    "GET /api/historical/files (owner) -> 200",
    histOwner.status === 200 && Array.isArray(histOwner.body?.data),
    `status ${histOwner.status}, count ${histOwner.body?.data?.length}`
  );
  const histAdmin = await api("/api/historical/files", { token: adminStaff });
  record("GET /api/historical/files (admin staff) -> 200", histAdmin.status === 200);
  const histIt = await api("/api/historical/files", { token: itStaff });
  record(
    "GET /api/historical/files (IT staff) -> 403",
    histIt.status === 403,
    `status ${histIt.status}`
  );
  const histFarmer = await api("/api/historical/files", { token: farmer });
  record("GET /api/historical/files (farmer) -> 403", histFarmer.status === 403);

  // ---- Unauthenticated / invalid tokens -----------------------------------
  const noToken = await api("/api/users");
  record("GET /api/users (no token) -> 401", noToken.status === 401);
  const badToken = await api("/api/users", { token: "not-a-real-token" });
  record("GET /api/users (garbage token) -> 401", badToken.status === 401);

  // ---- Self-protection: owner cannot change own status --------------------
  const meOwner = await api("/api/auth/me", { token: owner });
  const ownSelf = await api(`/api/users/${meOwner.body?.data?.id}/status`, {
    method: "PATCH",
    token: owner,
    body: { status: "DISABLED" },
  });
  record(
    "PATCH own status (owner) -> 403",
    ownSelf.status === 403,
    `status ${ownSelf.status}: ${ownSelf.body?.message}`
  );

  const failed = results.filter((result) => !result.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` — ${failed.length} FAILED` : ""
    }\n`
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
