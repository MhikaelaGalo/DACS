/**
 * View the Requirement 11 analytics without a frontend.
 *
 *   npx tsx scripts/view-analytics.ts                  -> dashboard summary
 *   npx tsx scripts/view-analytics.ts orders           -> one section
 *   npx tsx scripts/view-analytics.ts breeders
 *   npx tsx scripts/view-analytics.ts export orders    -> saves a CSV
 *   npx tsx scripts/view-analytics.ts token            -> prints a Bearer
 *                                                        token for Postman
 *
 * Sections: dashboard, customers, orders, payments, seminars, breeders,
 * inquiries. Extra query params can be appended, e.g.:
 *
 *   npx tsx scripts/view-analytics.ts orders "orderType=F1&from=2026-01-01"
 *
 * The script signs in as the test account, temporarily grants it staff
 * access (analytics is staff-only), and always restores the original
 * role afterwards.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync, writeFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const ACCOUNT_EMAIL =
  process.env.TEST_ACCOUNT_EMAIL ?? "dacs.farmer.fixture@dacs-test.example";

const SECTIONS = [
  "dashboard",
  "customers",
  "orders",
  "payments",
  "seminars",
  "breeders",
  "inquiries",
] as const;

async function getWebApiKey(projectId: string): Promise<string | null> {
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
}

async function mintIdToken(): Promise<string> {
  if (!firebaseAuth) {
    throw new Error("Firebase Admin is not configured.");
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8")) as {
    project_id: string;
  };

  const apiKey = await getWebApiKey(serviceAccount.project_id);
  if (!apiKey) {
    throw new Error("Could not fetch the Firebase web API key.");
  }

  const firebaseUser = await firebaseAuth.getUserByEmail(ACCOUNT_EMAIL);
  const customToken = await firebaseAuth.createCustomToken(firebaseUser.uid);

  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const signInBody = (await signIn.json()) as { idToken?: string };
  if (!signInBody.idToken) {
    throw new Error("Could not sign in to Firebase.");
  }

  return signInBody.idToken;
}

async function main(): Promise<void> {
  await assertTestServer();
  const target = process.argv[2] ?? "dashboard";
  const extra = process.argv[3] ?? "";

  const account = await prisma.user.findUnique({
    where: { email: ACCOUNT_EMAIL },
    select: { id: true, role: true },
  });

  if (!account) {
    throw new Error(`No DACS account found for ${ACCOUNT_EMAIL}.`);
  }

  const originalRole = account.role;

  console.log(`Signing in as ${ACCOUNT_EMAIL}...`);
  const idToken = await mintIdToken();

  if (target === "token") {
    console.log(
      "\nPaste this into Postman as a Bearer token (expires in ~1 hour).\n" +
        "Note: analytics endpoints also need your account to hold a staff\n" +
        "role while you call them.\n"
    );
    console.log(idToken);
    return;
  }

  // Analytics is staff-only; borrow the role for the duration of the
  // request and always put the original back.
  await prisma.user.update({
    where: { id: account.id },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  try {
    if (target === "export") {
      const report = process.argv[3] ?? "orders";
      const query = process.argv[4] ? `&${process.argv[4]}` : "";
      const response = await fetch(
        `${BASE_URL}/api/analytics/export?report=${report}${query}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (response.status !== 200) {
        console.error(`Export failed (${response.status}):`, await response.text());
        process.exitCode = 1;
        return;
      }

      const fileName = `dacs-${report}-export.csv`;
      writeFileSync(fileName, await response.text(), "utf-8");
      console.log(`Saved ${fileName} — open it in Excel.`);
      return;
    }

    if (!SECTIONS.includes(target as (typeof SECTIONS)[number])) {
      console.error(
        `Unknown section "${target}". Use one of: ${SECTIONS.join(", ")}, export, token.`
      );
      process.exitCode = 1;
      return;
    }

    const query = extra ? `?${extra}` : "";
    const response = await fetch(`${BASE_URL}/api/analytics/${target}${query}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    const body = (await response.json()) as { data?: unknown };

    if (response.status !== 200) {
      console.error(`Request failed (${response.status}):`, body);
      process.exitCode = 1;
      return;
    }

    console.log(`\nGET /api/analytics/${target}${query}\n`);
    console.log(JSON.stringify(body.data, null, 2));
  } finally {
    await prisma.user.update({
      where: { id: account.id },
      data: { role: originalRole },
    });
  }
}

main()
  .catch((error) => {
    console.error("Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
