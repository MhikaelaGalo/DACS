/**
 * Seed the five DACS admin staff accounts for frontend integration.
 *
 * For each account this script:
 *   1. creates (or updates) the Firebase Auth user with a password,
 *      a display name, and emailVerified = true;
 *   2. upserts the matching PostgreSQL users row with the correct role
 *      (POST /api/auth/sync would default new rows to CLIENT_FARMER and
 *      no Owner exists yet to promote them through the API).
 *
 * It also fetches the Firebase *web app* config via the Management API
 * (for the admin frontend's .env.local) and checks that the
 * Email/Password sign-in provider is enabled, enabling it when needed.
 *
 * Passwords are written to DACS-secrets/admin-staff-credentials.txt —
 * never into the repository. Re-running the script resets passwords to
 * the ones in that file (or generates new ones if the file is missing).
 *
 * Run: npx tsx scripts/seed-staff-users.ts
 */
import "dotenv/config";

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

import type { UserRole } from "../generated/prisma/client";

const SECRETS_DIR = "C:/Users/Ella Ignacio/DACS-secrets";
const CREDENTIALS_FILE = path.join(SECRETS_DIR, "admin-staff-credentials.txt");
const PROJECT_ID = "dacs-8f430";

interface StaffSeed {
  name: string;
  email: string;
  role: UserRole;
}

/* Must stay in sync with CHOOSER_ACCOUNTS in dacs-admin/src/lib/auth.ts. */
const STAFF: StaffSeed[] = [
  { name: "Erwin Joseph Cruz", email: "erwinjoseph.cruz@dominantasia.com", role: "OWNER_EXECUTIVE" },
  { name: "Adrian James Calalang", email: "adrian.calalang@dominantasia.com", role: "ADMINISTRATIVE_STAFF" },
  { name: "Ciara Frances Comendador", email: "ciara.comendador@dominantasia.com", role: "ADMINISTRATIVE_STAFF" },
  { name: "Mhikaela Ignacio Galo", email: "mhikaela.galo@dominantasia.com", role: "IT_STAFF" },
  { name: "Amanda Grace Mangubat", email: "amanda.mangubat@dominantasia.com", role: "IT_STAFF" },
];

function generatePassword(): string {
  return `Dacs-${randomBytes(9).toString("base64url")}`;
}

function loadExistingPasswords(): Map<string, string> {
  const passwords = new Map<string, string>();
  if (!existsSync(CREDENTIALS_FILE)) return passwords;
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\S+@\S+)\s+(\S+)$/);
    if (match) passwords.set(match[1].toLowerCase(), match[2]);
  }
  return passwords;
}

async function adminAccessToken(): Promise<string> {
  const credential = applicationDefault();
  const token = await credential.getAccessToken();
  return token.access_token;
}

async function getWebConfig(): Promise<Record<string, string> | null> {
  try {
    const headers = { Authorization: `Bearer ${await adminAccessToken()}` };
    const appsResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT_ID}/webApps`,
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
    return (await configResponse.json()) as Record<string, string>;
  } catch (error) {
    console.warn("Could not fetch web app config:", error);
    return null;
  }
}

async function ensureEmailPasswordProvider(apiKey: string, probe: StaffSeed, password: string): Promise<void> {
  const signIn = async () =>
    fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: probe.email, password, returnSecureToken: true }),
      }
    );

  let response = await signIn();
  if (response.ok) {
    console.log("Email/Password provider: enabled (sign-in probe succeeded).");
    return;
  }

  const body = (await response.json()) as { error?: { message?: string } };
  if (body.error?.message !== "OPERATION_NOT_ALLOWED") {
    throw new Error(`Sign-in probe failed unexpectedly: ${body.error?.message}`);
  }

  console.log("Email/Password provider is disabled — enabling it via the Identity Toolkit admin API...");
  const patchResponse = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=signIn.email`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${await adminAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
    }
  );
  if (!patchResponse.ok) {
    throw new Error(`Could not enable Email/Password provider: ${await patchResponse.text()}`);
  }

  response = await signIn();
  if (!response.ok) {
    throw new Error("Provider was enabled but the sign-in probe still fails.");
  }
  console.log("Email/Password provider: enabled just now; sign-in probe succeeded.");
}

async function main(): Promise<void> {
  if (!firebaseAuth) {
    throw new Error("Firebase Admin is not configured (GOOGLE_APPLICATION_CREDENTIALS).");
  }

  const passwords = loadExistingPasswords();
  const finalPasswords = new Map<string, string>();
  const lines: string[] = [
    "DACS admin staff test credentials (local development only).",
    "Regenerate by re-running back end/scripts/seed-staff-users.ts.",
    "",
  ];

  for (const staff of STAFF) {
    const password = passwords.get(staff.email.toLowerCase()) ?? generatePassword();
    finalPasswords.set(staff.email.toLowerCase(), password);

    let firebaseUid: string;
    try {
      const existing = await firebaseAuth.getUserByEmail(staff.email);
      await firebaseAuth.updateUser(existing.uid, {
        password,
        displayName: staff.name,
        emailVerified: true,
        disabled: false,
      });
      firebaseUid = existing.uid;
      console.log(`Firebase: updated ${staff.email}`);
    } catch {
      const created = await firebaseAuth.createUser({
        email: staff.email,
        password,
        displayName: staff.name,
        emailVerified: true,
      });
      firebaseUid = created.uid;
      console.log(`Firebase: created ${staff.email}`);
    }

    const user = await prisma.user.upsert({
      where: { email: staff.email },
      update: { firebaseUid, role: staff.role, status: "ACTIVE", displayName: staff.name },
      create: { firebaseUid, email: staff.email, role: staff.role, status: "ACTIVE", displayName: staff.name },
    });
    console.log(`PostgreSQL: ${staff.email} -> ${user.role} (${user.status})`);

    lines.push(`${staff.email} ${password}`);
  }

  writeFileSync(CREDENTIALS_FILE, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nCredentials written to ${CREDENTIALS_FILE}`);

  const config = await getWebConfig();
  if (config) {
    console.log("\nFirebase web app config (for dacs-admin/.env.local):");
    console.log(JSON.stringify(config, null, 2));
    await ensureEmailPasswordProvider(
      config.apiKey,
      STAFF[0],
      finalPasswords.get(STAFF[0].email.toLowerCase()) as string
    );
  } else {
    console.warn("No web app registered on the Firebase project — create one in the console.");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
