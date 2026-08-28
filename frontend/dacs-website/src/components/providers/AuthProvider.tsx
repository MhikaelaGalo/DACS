"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import * as authService from "@/services/auth.service";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  removeStorage,
  STORAGE_KEYS,
  writeStorage,
} from "@/lib/storage/local-storage";
import type { RegisterInput, SignInInput, User } from "@/types/user";

interface AuthContextValue {
  user: User | null;
  /** True once the initial Firebase session restore has completed. */
  ready: boolean;
  signIn: (input: SignInInput) => Promise<{ user?: User; error?: string }>;
  register: (input: RegisterInput) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /**
   * Rebuilds the session from the backend — call after profile/farm
   * edits or an avatar upload so every consumer sees the new data.
   */
  refreshUser: () => Promise<void>;
  /** Reload the Firebase user after email verification, then rebuild. */
  refreshVerification: () => Promise<{ user: User | null; error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const initialRestoreHandled = useRef(false);

  useEffect(() => {
    // The signing-out marker only matters within the interaction that
    // triggered it — never across page loads.
    window.sessionStorage.removeItem("dacs.signingOut");

    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (firebaseUser) => {
      if (!firebaseUser) {
        removeStorage(STORAGE_KEYS.sessionUid);
        setUser(null);
        initialRestoreHandled.current = true;
        setReady(true);
        return;
      }
      writeStorage(STORAGE_KEYS.sessionUid, firebaseUser.uid);
      if (!initialRestoreHandled.current) {
        // Initial page-load restore: compose the session from the backend.
        // Later sign-ins build their session inside signIn() itself, and
        // token refreshes never need a rebuild.
        initialRestoreHandled.current = true;
        void authService.buildSession().then((session) => {
          setUser(session.user);
          setReady(true);
        });
      }
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (input: SignInInput) => {
    const result = await authService.signIn(input);
    if (result.user) {
      writeStorage(STORAGE_KEYS.sessionUid, result.user.id);
      setUser(result.user);
      window.sessionStorage.removeItem("dacs.signingOut");
    }
    return result;
  }, []);

  // Registration creates the Firebase account and the onboarding draft
  // only — no session is started; the customer verifies their email and
  // signs in explicitly afterwards.
  const register = useCallback(async (input: RegisterInput) => {
    return authService.register(input);
  }, []);

  const signOut = useCallback(async () => {
    await authService.signOut();
    removeStorage(STORAGE_KEYS.sessionUid);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const session = await authService.buildSession();
    setUser(session.user);
  }, []);

  const refreshVerification = useCallback(async () => {
    const result = await authService.refreshVerificationState();
    setUser(result.user);
    return result;
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, ready, signIn, register, signOut, refreshUser, refreshVerification }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
