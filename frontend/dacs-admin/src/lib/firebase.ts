/*
 * Firebase web client for the admin portal. Client-side only — every
 * entry point guards on `typeof window` because the Next.js build also
 * evaluates modules on the server.
 *
 * Config comes from .env.local (NEXT_PUBLIC_FIREBASE_*), fetched from
 * the dacs-8f430 project via back end/scripts/seed-staff-users.ts.
 */
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;

export function getFirebaseAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("Firebase Auth is only available in the browser.");
  }
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return getAuth(app);
}

/*
 * Firebase restores the persisted session asynchronously after page
 * load; auth.currentUser is null until the first onAuthStateChanged
 * emission. Anything that needs a token must wait for that emission.
 */
let authReady: Promise<void> | null = null;

export function waitForAuthReady(): Promise<void> {
  if (!authReady) {
    authReady = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(getFirebaseAuth(), () => {
        unsubscribe();
        resolve();
      });
    });
  }
  return authReady;
}

export async function getCurrentFirebaseUser(): Promise<User | null> {
  await waitForAuthReady();
  return getFirebaseAuth().currentUser;
}

/*
 * Current user's Firebase ID token (auto-refreshed by the SDK when it
 * is close to expiry), or null when nobody is signed in.
 */
export async function getIdTokenOrNull(): Promise<string | null> {
  const user = await getCurrentFirebaseUser();
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function signOutFirebase(): Promise<void> {
  try {
    await firebaseSignOut(getFirebaseAuth());
  } catch {
    /* Already signed out (or storage unavailable) — nothing to do. */
  }
}
