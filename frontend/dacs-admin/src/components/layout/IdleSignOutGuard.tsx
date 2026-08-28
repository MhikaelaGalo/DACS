"use client";

import { useEffect, useRef, useState } from "react";

import { signOut } from "@/lib/auth";
import {
  forceSignOut,
  IDLE_TIMEOUT_MINUTES,
  IDLE_WARNING_SECONDS,
} from "@/lib/sessionExpiry";
import { readStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage";

const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000;
const WARNING_MS = IDLE_WARNING_SECONDS * 1_000;

/*
 * Captured on window so interaction anywhere counts — including scroll
 * inside nested containers, which never bubbles to window on its own.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

/*
 * Signs staff out after IDLE_TIMEOUT_MINUTES without interaction,
 * with an "Are you still there?" countdown for the final
 * IDLE_WARNING_SECONDS. Mounted once inside the admin layout, so it
 * only ever runs for a signed-in staff session. The last-activity
 * timestamp is shared through localStorage so working in one admin tab
 * keeps a second tab alive, and a laptop asleep past the limit is
 * signed out on the first tick after waking.
 */
export function IdleSignOutGuard() {
  /* Seconds until sign-out; null while the user counts as active. */
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActivityRef = useRef(0);
  const warningRef = useRef(false);

  useEffect(() => {
    /* Loading an admin page is itself activity. */
    lastActivityRef.current = Date.now();
    writeStorage(STORAGE_KEYS.lastActivity, lastActivityRef.current);

    /*
     * Once the warning is up, mouse noise must not dismiss it — only
     * the explicit "Stay signed in" button resets the clock.
     */
    const markActivity = () => {
      if (!warningRef.current) lastActivityRef.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, markActivity, {
        passive: true,
        capture: true,
      });
    }

    const timer = window.setInterval(() => {
      const stored = readStorage<number>(STORAGE_KEYS.lastActivity, 0);
      const last = Math.max(lastActivityRef.current, stored);
      lastActivityRef.current = last;
      /* Publish for other tabs, throttled to one write per 5s. */
      if (last - stored > 5_000) {
        writeStorage(STORAGE_KEYS.lastActivity, last);
      }

      const idleMs = Date.now() - last;
      if (idleMs >= IDLE_TIMEOUT_MS) {
        forceSignOut("idle");
        return;
      }
      if (idleMs >= IDLE_TIMEOUT_MS - WARNING_MS) {
        warningRef.current = true;
        setRemaining(Math.ceil((IDLE_TIMEOUT_MS - idleMs) / 1000));
      } else {
        warningRef.current = false;
        setRemaining(null);
      }
    }, 1_000);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, markActivity, { capture: true });
      }
      window.clearInterval(timer);
    };
  }, []);

  if (remaining === null) return null;

  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  function staySignedIn() {
    warningRef.current = false;
    lastActivityRef.current = Date.now();
    writeStorage(STORAGE_KEYS.lastActivity, lastActivityRef.current);
    setRemaining(null);
  }

  /* Same card styling as ConfirmDialog, minus click-outside dismissal. */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-[460px] rounded-dacs-card bg-white p-6 text-center shadow-dacs-card sm:p-8">
        <p className="text-lg font-bold">Are you still there?</p>
        <p className="mt-2 text-sm text-dacs-muted">
          You have been inactive for a while. For security, you will be
          signed out in {minutes}:{seconds}.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={staySignedIn}
            className="rounded-2xl bg-dacs-dark px-7 py-3 font-semibold text-white hover:opacity-90"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={() => {
              signOut();
              window.location.replace("/sign-in");
            }}
            className="rounded-2xl border border-dacs-dark/40 px-7 py-3 font-semibold hover:bg-dacs-light/50"
          >
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
