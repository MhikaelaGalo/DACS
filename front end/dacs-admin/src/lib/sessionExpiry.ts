/*
 * Session-lifetime policy for the admin portal.
 *
 * Firebase keeps people signed in indefinitely by default (local
 * persistence plus silently refreshed ID tokens). That is fine for
 * farmers on the customer site but not for staff handling customer
 * data, so staff sessions are bounded twice:
 *   - Idle timeout (enforced here, client-side): signed out after
 *     IDLE_TIMEOUT_MINUTES without interaction — see IdleSignOutGuard
 *     in the admin layout, which warns before it fires.
 *   - Absolute cap (enforced by the backend): staff API calls return
 *     401 once the Google sign-in (the token's auth_time) is older
 *     than SESSION_MAX_AGE_HOURS — see back end/src/middleware/
 *     loadDacsUser.ts. The 401 lands in api.ts, which calls
 *     forceSignOut below.
 */
import { signOutFirebase } from "./firebase";
import { removeStorage, STORAGE_KEYS } from "./storage";

export const IDLE_TIMEOUT_MINUTES = 30;

/* The "Are you still there?" dialog shows this long before sign-out. */
export const IDLE_WARNING_SECONDS = 120;

export type SignOutReason = "idle" | "expired";

/*
 * Drop the session and land on /sign-in with a banner explaining why.
 * While already on /sign-in only the cleanup runs — never a redirect,
 * so a failed sign-in attempt cannot reload the page out from under
 * its own error message.
 */
export function forceSignOut(reason: SignOutReason): void {
  if (typeof window === "undefined") return;
  removeStorage(STORAGE_KEYS.session);
  void signOutFirebase();
  if (!window.location.pathname.startsWith("/sign-in")) {
    window.location.replace(`/sign-in?reason=${reason}`);
  }
}
