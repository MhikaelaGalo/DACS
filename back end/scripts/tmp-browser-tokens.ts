/*
 * Browser-verification helper (temporary): mints REST sessions for the
 * synthetic farmer fixture and the owner staff account, and prints the
 * IndexedDB firebase:authUser records the bundled SDK will restore.
 * Output: JSON on stdout. Run with the DEV env (cloud dacs).
 */
import "dotenv/config";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const PROJECT_ID = "dacs-8f430";
const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";
const OWNER_EMAIL = "erwinjoseph.cruz@dominantasia.com";

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

async function sessionFor(apiKey: string, email: string) {
  if (!firebaseAuth) throw new Error("Firebase Admin not configured.");
  const userRecord = await firebaseAuth.getUserByEmail(email);
  const customToken = await firebaseAuth.createCustomToken(userRecord.uid);
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const tokens = (await signIn.json()) as {
    idToken?: string;
    refreshToken?: string;
    expiresIn?: string;
  };
  if (!tokens.idToken) throw new Error(`Sign-in failed for ${email}`);
  const lookupResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: tokens.idToken }),
    }
  );
  const lookup = (await lookupResponse.json()) as { users?: Array<any> };
  const info = lookup.users?.[0] ?? {};
  const now = Date.now();
  const authUser = {
    uid: userRecord.uid,
    email,
    emailVerified: info.emailVerified ?? true,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.idToken,
      expirationTime: now + Number(tokens.expiresIn ?? "3600") * 1000,
    },
    createdAt: info.createdAt ?? String(now),
    lastLoginAt: info.lastLoginAt ?? String(now),
    apiKey,
    appName: "[DEFAULT]",
  };
  return { uid: userRecord.uid, authUser };
}

async function main(): Promise<void> {
  const apiKey = await getWebApiKey();
  const farmer = await sessionFor(apiKey, FARMER_EMAIL);
  const owner = await sessionFor(apiKey, OWNER_EMAIL);
  console.log(
    JSON.stringify({ apiKey, farmer, owner })
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
