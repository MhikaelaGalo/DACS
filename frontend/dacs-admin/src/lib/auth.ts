/*
 * Staff session, backed by real Google authentication + the DACS
 * backend. Sign-in flow: signInWithPopup(GoogleAuthProvider) — the
 * genuine Google account selector, never a DACS-rendered password
 * field — then POST /api/auth/sync and GET /api/auth/me; the backend's
 * users.role column is the only authority on roles. The session object
 * cached in localStorage exists so layout gates can read identity
 * synchronously — every API request still carries a fresh Firebase ID
 * token and is re-authorized server-side, so the cache can never grant
 * access by itself.
 */
import { FirebaseError } from "firebase/app";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

import { api, ApiError } from "./api";
import { getFirebaseAuth, signOutFirebase } from "./firebase";
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from "./storage";

export type StaffRole = "OWNER_EXECUTIVE" | "ADMINISTRATIVE_STAFF" | "IT_STAFF";

export interface StaffSession {
  name: string;
  email: string;
  role: StaffRole;
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  OWNER_EXECUTIVE: "Owner",
  ADMINISTRATIVE_STAFF: "Administrative Staff",
  IT_STAFF: "Staff",
};

export const ROLE_BY_LABEL: Record<string, StaffRole> = {
  Owner: "OWNER_EXECUTIVE",
  "Administrative Staff": "ADMINISTRATIVE_STAFF",
  Staff: "IT_STAFF",
};

/*
 * The seeded development staff roster (back end/scripts/
 * seed-staff-users.ts). No longer rendered as a sign-in chooser — the
 * real Google popup has its own account selector — but kept as a
 * display-name fallback for these dev accounts in User Management.
 */
export const CHOOSER_ACCOUNTS: Array<{
  name: string;
  email: string;
  role: StaffRole;
}> = [
  { name: "Adrian James Calalang", email: "adrian.calalang@dominantasia.com", role: "ADMINISTRATIVE_STAFF" },
  { name: "Ciara Frances Comendador", email: "ciara.comendador@dominantasia.com", role: "ADMINISTRATIVE_STAFF" },
  { name: "Mhikaela Ignacio Galo", email: "mhikaela.galo@dominantasia.com", role: "IT_STAFF" },
  { name: "Amanda Grace Mangubat", email: "amanda.mangubat@dominantasia.com", role: "IT_STAFF" },
  { name: "Erwin Joseph Cruz", email: "erwinjoseph.cruz@dominantasia.com", role: "OWNER_EXECUTIVE" },
];

interface DacsAccount {
  id: string;
  email: string;
  emailVerified: boolean;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
}

export function getSession(): StaffSession | null {
  return readStorage<StaffSession | null>(STORAGE_KEYS.session, null);
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export async function fetchStaffSession(displayName: string | null): Promise<StaffSession> {
  const { data: account } = await api.get<{ data: DacsAccount }>("/api/auth/me");
  const role = account.role as StaffRole;
  if (account.status !== "ACTIVE" || !Object.hasOwn(ROLE_LABELS, role)) {
    throw new ApiError(403, "This account does not have permission to access the admin portal.");
  }
  return { name: displayName || nameFromEmail(account.email), email: account.email, role };
}

export function cacheStaffSession(session: StaffSession): void {
  writeStorage(STORAGE_KEYS.session, session);
}

/* Raw Firebase auth errors are never surfaced to the UI. */
function friendlyAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "The Google sign-in window was closed before finishing. Please try again.";
      case "auth/popup-blocked":
        return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
      case "auth/operation-not-allowed":
      case "auth/unauthorized-domain":
        return "Google sign-in is not enabled for this system yet. Contact your administrator.";
      case "auth/too-many-requests":
        return "Too many sign-in attempts. Please wait a moment and try again.";
      case "auth/user-disabled":
        return "This account has been disabled. Contact your administrator.";
      case "auth/network-request-failed":
        return "Cannot reach the sign-in service. Check your connection and try again.";
      default:
        return "Unable to sign in. Please try again.";
    }
  }
  return "Unable to sign in. Please try again.";
}

/*
 * Real Google sign-in: the genuine Google/Firebase account-selector
 * popup proves who the person is; whether they may enter the admin
 * portal is decided solely by the DACS backend (users.role must be a
 * staff role, status must be ACTIVE). Farmers, unknown Google accounts
 * and suspended/disabled users get a friendly error instead of a
 * session. DACS never sees or stores any Google password.
 */
export async function signInWithGoogle(): Promise<{
  session?: StaffSession;
  error?: string;
}> {
  let displayName: string | null;
  try {
    const provider = new GoogleAuthProvider();
    /* Always show Google's own account chooser. */
    provider.setCustomParameters({ prompt: "select_account" });
    const credential = await signInWithPopup(getFirebaseAuth(), provider);
    displayName = credential.user.displayName;
  } catch (error) {
    return { error: friendlyAuthError(error) };
  }

  try {
    await api.post("/api/auth/sync");
    const session = await fetchStaffSession(displayName);
    cacheStaffSession(session);
    return { session };
  } catch (error) {
    /*
     * The backend refused the account (suspended/disabled -> 403 with a
     * readable message) or is unreachable. Never leave a half-signed-in
     * Firebase state behind.
     */
    await signOutFirebase();
    if (error instanceof ApiError) {
      return { error: error.message };
    }
    return { error: "Unable to sign in. Please try again." };
  }
}

export function signOut(): void {
  removeStorage(STORAGE_KEYS.session);
  /* Fire-and-forget; the redirect to /sign-in does not need to wait. */
  void signOutFirebase();
}
