/**
 * Thin wrapper around window.localStorage.
 *
 * Since the Firebase/backend integration, localStorage holds only
 * client-side conveniences (cart, saved delivery info, UI pointers)
 * scoped per Firebase account. All operational data (profile, farms,
 * orders, seminars, notifications, tickets) lives in the DACS backend.
 */

export function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private browsing); data simply won't persist.
  }
}

export function removeStorage(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

export const STORAGE_KEYS = {
  /**
   * Firebase uid of the signed-in account, written by AuthProvider so the
   * synchronous per-account storage helpers below can scope their keys.
   * Never holds profile data — the session itself lives with Firebase.
   */
  sessionUid: "dacs.sessionUid",
} as const;

/**
 * Per-account data. These are key PREFIXES — the stored key is
 * "<base>.<firebaseUid>" (see readUserStorage/writeUserStorage), so the
 * cart and saved delivery details never leak between accounts sharing
 * one browser.
 */
export const USER_STORAGE_KEYS = {
  cart: "dacs.cart",
  delivery: "dacs.delivery",
  activeSeminarId: "dacs.activeSeminarId",
  /*
   * Mock-era bases still referenced by services that have not been
   * repointed to the backend yet; each integration wave deletes the
   * entries it obsoletes. Do not add new consumers.
   */
  certificationDocuments: "dacs.certificationDocuments",
} as const;

/**
 * Every localStorage key the pre-integration mock build ever wrote. Used
 * only by purgeMockStorage — the mock era stored plaintext passwords
 * (dacs.users / dacs.currentUser) and per-account copies of operational
 * data under mock ids ("user-1", "user-<timestamp>"), all of which must
 * be actively removed from visitors' browsers, not just abandoned.
 */
const LEGACY_GLOBAL_KEYS = ["dacs.users", "dacs.currentUser"];
const LEGACY_USER_KEY_BASES = [
  "dacs.cart",
  "dacs.orders",
  "dacs.seminars",
  "dacs.seminarRegistration",
  "dacs.seminarRegistrationDetails",
  "dacs.seminarExamResult",
  "dacs.seminarExamAttempts",
  "dacs.activeSeminarId",
  "dacs.notifications",
  "dacs.tickets",
  "dacs.farm",
  "dacs.certificationDocuments",
  "dacs.certificates.dacs",
  "dacs.delivery",
];

/**
 * Key bases of features removed from the site entirely (the Wallet page,
 * removed 2026-08-25). Unlike the mock-era keys these were also written
 * scoped to real Firebase uids, so every "<base>.<uid>" copy must go too.
 */
const RETIRED_USER_KEY_BASES = ["dacs.wallet"];

let purgeDone = false;

export function purgeMockStorage(): void {
  if (typeof window === "undefined" || purgeDone) return;
  purgeDone = true;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (LEGACY_GLOBAL_KEYS.includes(key)) {
        doomed.push(key);
        continue;
      }
      if (
        RETIRED_USER_KEY_BASES.some(
          (base) => key === base || key.startsWith(`${base}.`)
        )
      ) {
        doomed.push(key);
        continue;
      }
      for (const base of LEGACY_USER_KEY_BASES) {
        // Bare pre-scoping keys and mock-id scoped keys ("<base>.user-...")
        // both go; Firebase-uid scoped keys survive.
        if (key === base || key.startsWith(`${base}.user-`)) {
          doomed.push(key);
          break;
        }
      }
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage unavailable — nothing to purge.
  }
}

/** Firebase uid of the signed-in account (null when signed out). */
function currentUserId(): string | null {
  return readStorage<string | null>(STORAGE_KEYS.sessionUid, null);
}

function scopedKey(base: string, userId: string): string {
  return `${base}.${userId}`;
}

/**
 * Reads a per-account value for the signed-in user. Signed out (or during
 * SSR) it returns the fallback, so locked/empty defaults hold until a
 * real session exists.
 */
export function readUserStorage<T>(base: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const userId = currentUserId();
  if (!userId) return fallback;
  return readStorage(scopedKey(base, userId), fallback);
}

/** Writes a per-account value for the signed-in user; no-op when signed out. */
export function writeUserStorage<T>(base: string, value: T): void {
  if (typeof window === "undefined") return;
  const userId = currentUserId();
  if (!userId) return;
  writeStorage(scopedKey(base, userId), value);
}

// Remove the mock era's plaintext-credential keys as soon as any storage
// consumer loads on the client.
if (typeof window !== "undefined") {
  purgeMockStorage();
}
