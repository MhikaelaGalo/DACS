/**
 * Prints a fresh Firebase ID token for the test user — handy for manual
 * PowerShell testing without re-entering a password:
 *
 *   $idToken = (npx tsx scripts/get-token.ts | Select-Object -Last 1).Trim()
 *
 * The signed-in email is printed to stderr; stdout carries only the token.
 */
import "dotenv/config";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { firebaseAuth } from "../src/config/firebase";

async function main(): Promise<void> {
  if (!firebaseAuth) {
    throw new Error("Firebase Admin is not configured. Check GOOGLE_APPLICATION_CREDENTIALS.");
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8")) as {
    project_id: string;
  };

  const credential = applicationDefault();
  const accessToken = await credential.getAccessToken();
  const headers = { Authorization: `Bearer ${accessToken.access_token}` };

  const appsResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${serviceAccount.project_id}/webApps`,
    { headers }
  );
  const apps =
    ((await appsResponse.json()) as { apps?: Array<{ name: string }> }).apps ??
    [];
  if (!apps.length) {
    throw new Error("No Firebase web app is registered for this project.");
  }

  const configResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/${apps[0]!.name}/config`,
    { headers }
  );
  const apiKey = ((await configResponse.json()) as { apiKey?: string }).apiKey;
  if (!apiKey) {
    throw new Error("Could not read the web API key.");
  }

  const userList = await firebaseAuth.listUsers(10);
  const user = userList.users.find((candidate) => candidate.email);
  if (!user) {
    throw new Error("No Firebase user found. Create one in the Firebase console first.");
  }

  const customToken = await firebaseAuth.createCustomToken(user.uid);
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const idToken = ((await signInResponse.json()) as { idToken?: string })
    .idToken;
  if (!idToken) {
    throw new Error("Failed to mint an ID token.");
  }

  console.error(`Signed in as ${user.email}`);
  console.log(idToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
