import "dotenv/config";

import { existsSync, readFileSync } from "node:fs";

import { cert, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;

if (credentialPath && existsSync(credentialPath)) {
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8"));
  firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });
  firebaseAuth = getAuth(firebaseApp);
} else {
  console.warn(
    "[firebase] Firebase Admin is NOT initialized. " +
      "Place the service-account JSON at the path set in GOOGLE_APPLICATION_CREDENTIALS " +
      `(currently: ${credentialPath ?? "not set"}) and restart the server.`
  );
}

export { firebaseApp, firebaseAuth };
