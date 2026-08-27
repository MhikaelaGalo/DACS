"use client";

/*
 * Keeps a page's backend data current without a query library.
 *
 * Every admin page loads its data through a `load` callback; this hook
 * owns WHEN that callback runs:
 *
 *   - once on mount                        -> load("initial")
 *   - every `intervalMs` while the tab is
 *     visible (paused when hidden)         -> load("refresh")
 *   - when the tab/window regains focus
 *     and the data is older than a few
 *     seconds                              -> load("refresh")
 *
 * The mode lets pages keep the two paths honest: an "initial" failure
 * replaces the empty table with an error message, while a "refresh"
 * failure keeps the last good rows on screen (the next tick retries).
 * Mutations are unaffected — they already merge the server response
 * into state or refetch explicitly.
 *
 * Overlap guard: a tick is skipped while the previous load is still in
 * flight, so a slow backend never stacks requests. The `load` identity
 * is read through a ref, so an unstable callback (e.g. one depending on
 * `showToast`) never resets the interval.
 */
import { useEffect, useRef } from "react";

export type LoadMode = "initial" | "refresh";

/* Focus refetches are skipped when the data is fresher than this. */
const FOCUS_MIN_AGE_MS = 5_000;

export function useAutoRefresh(
  load: (mode: LoadMode) => Promise<void>,
  intervalMs = 30_000
): void {
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let inFlight = false;
    let lastFinishedAt = 0;

    async function run(mode: LoadMode) {
      if (inFlight) return;
      inFlight = true;
      try {
        await loadRef.current(mode);
      } finally {
        inFlight = false;
        lastFinishedAt = Date.now();
      }
    }

    void run("initial");

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void run("refresh");
    }, intervalMs);

    function onVisible() {
      if (document.hidden) return;
      if (Date.now() - lastFinishedAt < FOCUS_MIN_AGE_MS) return;
      void run("refresh");
    }

    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
}
