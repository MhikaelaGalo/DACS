"use client";

import { useEffect, useRef, useState } from "react";

import { readStorage, writeStorage } from "./storage";

/*
 * Mock persistence hook: state seeded from a default, hydrated from
 * localStorage after mount (SSR-safe), written through on every change.
 * Backend integration replaces the storage read/write with API calls —
 * the component-facing API (value, setValue) stays identical.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, (next: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  const keyRef = useRef(key);

  useEffect(() => {
    setValue(readStorage<T>(keyRef.current, initial));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(next: T | ((current: T) => T)) {
    setValue((current) => {
      const resolved =
        typeof next === "function" ? (next as (c: T) => T)(current) : next;
      writeStorage(keyRef.current, resolved);
      return resolved;
    });
  }

  return [value, update, hydrated];
}
