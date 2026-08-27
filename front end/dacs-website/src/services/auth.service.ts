/*
 * Real authentication for the DACS customer site.
 *
 * Identity lives in Firebase Authentication (email/password); the DACS
 * backend owns the account row (role/status) and all profile data. DACS
 * never sees or stores passwords — credential operations go through the
 * Firebase client SDK, and every backend call carries the Firebase ID
 * token (see src/lib/api.ts).
 *
 * Session composition: POST /api/auth/sync (creates/links the users row)
 * -> GET /api/auth/me (role/status/emailVerified) -> GET /api/customers/me
 * (profile + farms; 404 until onboarding completes). Registration stores
 * the profile/farm details as a local draft because the backend only
 * accepts profile creation after the email address is verified.
 */
import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { ApiError } from "@/lib/api";
import {
  composeAddress,
  createFarm,
  createMyProfile,
  getAccount,
  getMyProfile,
  syncAccount,
  type ApiCustomerProfile,
  type ProfileFields,
} from "@/lib/api/account";
import {
  getCurrentFirebaseUser,
  getFirebaseAuth,
  signOutFirebase,
} from "@/lib/firebase";
import { readStorage, removeStorage, writeStorage } from "@/lib/storage/local-storage";
import { DEFAULT_AVATAR_URL } from "@/constants/profile";
import type { RegisterInput, SignInInput, User } from "@/types/user";

/* ------------------------------------------------------------------ */
/* Firebase error translation                                          */
/* ------------------------------------------------------------------ */

function friendlyAuthError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/email-already-in-use":
        return "An account with this email already exists.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      case "auth/weak-password":
        return "Password must be at least 8 characters.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "Incorrect email or password.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a moment and try again.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/network-request-failed":
        return "Cannot reach the sign-in service. Please check your connection.";
      default:
        return fallback;
    }
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Registration draft (held until the email is verified)               */
/* ------------------------------------------------------------------ */

interface OnboardingDraft {
  fullName: string;
  contactNumber: string;
  completeAddress: string;
  farmName: string;
  farmAddress: string;
}

function draftKey(uid: string): string {
  return `dacs.pendingOnboarding.${uid}`;
}

function saveOnboardingDraft(uid: string, draft: OnboardingDraft): void {
  writeStorage(draftKey(uid), draft);
}

function readOnboardingDraft(uid: string): OnboardingDraft | null {
  return readStorage<OnboardingDraft | null>(draftKey(uid), null);
}

function clearOnboardingDraft(uid: string): void {
  removeStorage(draftKey(uid));
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/**
 * Splits a typed full name into the backend's firstName/lastName(/suffix)
 * columns: a trailing generational suffix is peeled off, the final word
 * becomes the last name, everything before it the first name(s).
 */
export function splitFullName(fullName: string): {
  firstName: string;
  lastName: string;
  suffix?: string;
} {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  let suffix: string | undefined;
  if (tokens.length > 2 && NAME_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    suffix = tokens.pop();
  }
  if (tokens.length === 1) {
    return { firstName: tokens[0], lastName: tokens[0], suffix };
  }
  const lastName = tokens.pop() as string;
  return { firstName: tokens.join(" "), lastName, suffix };
}

/**
 * Creates the customer profile (and first farm) from the registration
 * draft. Runs only once the email is verified — the backend rejects
 * profile writes before that. The free-text address strings go into
 * addressLine1; the granular PH columns stay empty until the customer
 * refines them (or staff do).
 */
async function runOnboarding(uid: string, draft: OnboardingDraft): Promise<void> {
  const { firstName, lastName, suffix } = splitFullName(draft.fullName);
  const fields: ProfileFields = {
    firstName,
    lastName,
    phoneNumber: draft.contactNumber,
    addressLine1: draft.completeAddress,
  };
  if (suffix) fields.suffix = suffix;
  let profile: ApiCustomerProfile;
  try {
    profile = await createMyProfile(fields);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // Profile already exists (e.g. created in another tab) — carry on.
      profile = await getMyProfile();
    } else if (
      error instanceof ApiError &&
      error.status === 400 &&
      error.field === "phoneNumber"
    ) {
      // Save the profile even when the typed number fails the backend's
      // phone format; the customer can correct it on the account page.
      delete fields.phoneNumber;
      profile = await createMyProfile(fields);
    } else {
      throw error;
    }
  }
  // A claimed historical profile may already carry farms; only seed the
  // registration farm when none exists.
  if (!profile.farms || profile.farms.length === 0) {
    await createFarm({ farmName: draft.farmName, addressLine1: draft.farmAddress });
  }
  clearOnboardingDraft(uid);
}

/* ------------------------------------------------------------------ */
/* Session composition                                                 */
/* ------------------------------------------------------------------ */

function toSessionUser(
  uid: string,
  email: string,
  emailVerified: boolean,
  displayName: string | null,
  profile: ApiCustomerProfile | null
): User {
  const primaryFarm =
    profile?.farms?.find((farm) => farm.isPrimary) ?? profile?.farms?.[0];
  const fullName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ")
    : displayName ?? email.split("@")[0];
  return {
    id: uid,
    fullName,
    email,
    emailVerified,
    hasProfile: profile !== null,
    contactNumber: profile?.phoneNumber ?? "",
    completeAddress: profile
      ? composeAddress([
          profile.addressLine1,
          profile.barangay,
          profile.cityMunicipality,
          profile.province,
        ])
      : "",
    avatarUrl: profile?.profileImageUrl ?? DEFAULT_AVATAR_URL,
    facebookName: profile?.facebookName ?? undefined,
    occupation: profile?.occupation ?? undefined,
    contactEmail: profile?.contactEmail ?? undefined,
    customerNumber: profile?.customerNumber,
    profileId: profile?.id,
    firstName: profile?.firstName,
    middleName: profile?.middleName ?? undefined,
    lastName: profile?.lastName,
    suffix: profile?.suffix ?? undefined,
    primaryFarmId: primaryFarm?.id,
    farmName: primaryFarm?.farmName,
    farmAddress: primaryFarm
      ? composeAddress([
          primaryFarm.addressLine1,
          primaryFarm.barangay,
          primaryFarm.cityMunicipality,
          primaryFarm.province,
        ])
      : undefined,
  };
}

/**
 * Builds the app session for the signed-in Firebase user. Returns null
 * user with a reason when the account cannot use the customer site
 * (staff account, suspended/disabled, backend unreachable) — the
 * Firebase session is dropped in those cases so guards see signed-out.
 */
export async function buildSession(): Promise<{ user: User | null; error?: string }> {
  const firebaseUser = await getCurrentFirebaseUser();
  if (!firebaseUser || !firebaseUser.email) return { user: null };
  try {
    /*
     * Sync first — it creates/links the users row the other two read.
     * The account and the profile only depend on that row, not on each
     * other, so they go out together: composing the session used to cost
     * three sequential backend round-trips before any page could render.
     */
    await syncAccount();
    const [account, profileResult] = await Promise.all([
      getAccount(),
      getMyProfile().catch((error: unknown) => {
        // 404 = onboarding not finished yet; anything else is a real fault.
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        return null;
      }),
    ]);

    if (account.role !== "CLIENT_FARMER") {
      await signOutFirebase();
      return {
        user: null,
        error:
          "This is a DACS staff account. Please sign in through the admin portal instead.",
      };
    }
    const emailVerified = account.emailVerified ?? firebaseUser.emailVerified;

    let profile: ApiCustomerProfile | null = profileResult;

    if (!profile && emailVerified) {
      const draft = readOnboardingDraft(firebaseUser.uid);
      if (draft) {
        try {
          await runOnboarding(firebaseUser.uid, draft);
          profile = await getMyProfile();
        } catch {
          // Draft kept; the account page offers profile completion.
        }
      }
    }

    return {
      user: toSessionUser(
        firebaseUser.uid,
        account.email,
        emailVerified,
        firebaseUser.displayName,
        profile
      ),
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
      // Suspended/disabled accounts (or a revoked token): drop the
      // Firebase session and surface the backend's own wording.
      await signOutFirebase();
      return { user: null, error: error.message };
    }
    if (error instanceof ApiError && error.status === 0) {
      // Backend unreachable: keep the Firebase session so a reload can
      // recover, but report no user for now.
      return { user: null, error: error.message };
    }
    return {
      user: null,
      error: "Unable to load your account right now. Please try again.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Flows                                                               */
/* ------------------------------------------------------------------ */

export async function signIn(
  input: SignInInput
): Promise<{ user?: User; error?: string }> {
  try {
    await signInWithEmailAndPassword(
      getFirebaseAuth(),
      input.email.trim(),
      input.password
    );
  } catch (error) {
    return {
      error: friendlyAuthError(
        error,
        "Unable to sign in. Please check your credentials and try again."
      ),
    };
  }
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem("dacs.signingOut");
  }
  const session = await buildSession();
  if (!session.user) {
    return { error: session.error ?? "Unable to sign in. Please try again later." };
  }
  return { user: session.user };
}

/**
 * Creates the Firebase account, stores the profile/farm details as a
 * draft, sends the verification email and signs back out — the customer
 * signs in explicitly on the Sign In page (matching the existing UX).
 */
export async function register(
  input: RegisterInput
): Promise<{ error?: string }> {
  try {
    const credential = await createUserWithEmailAndPassword(
      getFirebaseAuth(),
      input.email.trim(),
      input.password
    );
    saveOnboardingDraft(credential.user.uid, {
      fullName: input.fullName.trim(),
      contactNumber: input.contactNumber.trim(),
      completeAddress: input.completeAddress.trim(),
      farmName: input.farmName.trim(),
      farmAddress: input.farmAddress.trim(),
    });
    try {
      await updateProfile(credential.user, { displayName: input.fullName.trim() });
      await sendEmailVerification(credential.user);
    } catch {
      // Verification email can be re-sent from the account banner later.
    }
    await signOutFirebase();
    return {};
  } catch (error) {
    return {
      error: friendlyAuthError(
        error,
        "Unable to create the account. Please try again later."
      ),
    };
  }
}

export async function signOut(): Promise<void> {
  // Transient marker so route guards on the page being left send the
  // customer to the public Home page instead of the Sign In page.
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem("dacs.signingOut", "1");
  }
  await signOutFirebase();
}

export async function requestPasswordReset(
  email: string
): Promise<{ error?: string }> {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
    return {};
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "auth/user-not-found") {
      // Do not reveal whether the email is registered.
      return {};
    }
    return {
      error: friendlyAuthError(
        error,
        "Unable to send the reset email. Please try again later."
      ),
    };
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ error?: string }> {
  const firebaseUser = await getCurrentFirebaseUser();
  if (!firebaseUser || !firebaseUser.email) {
    return { error: "Please sign in again to change your password." };
  }
  try {
    await reauthenticateWithCredential(
      firebaseUser,
      EmailAuthProvider.credential(firebaseUser.email, currentPassword)
    );
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      (error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password")
    ) {
      return { error: "Current password is incorrect." };
    }
    return {
      error: friendlyAuthError(error, "Unable to verify your current password."),
    };
  }
  try {
    await updatePassword(firebaseUser, newPassword);
    return {};
  } catch (error) {
    return {
      error: friendlyAuthError(
        error,
        "Unable to change the password. Please try again later."
      ),
    };
  }
}

export async function resendVerificationEmail(): Promise<{ error?: string }> {
  const firebaseUser = await getCurrentFirebaseUser();
  if (!firebaseUser) {
    return { error: "Please sign in again first." };
  }
  try {
    await sendEmailVerification(firebaseUser);
    return {};
  } catch (error) {
    return {
      error: friendlyAuthError(
        error,
        "Unable to send the verification email right now. Please try again in a few minutes."
      ),
    };
  }
}

/**
 * Re-reads the Firebase user (picking up a just-completed email
 * verification) and rebuilds the session. Forcing a token refresh makes
 * the backend see email_verified immediately.
 */
export async function refreshVerificationState(): Promise<{
  user: User | null;
  error?: string;
}> {
  const firebaseUser = await getCurrentFirebaseUser();
  if (!firebaseUser) return { user: null };
  try {
    await firebaseUser.reload();
    await firebaseUser.getIdToken(true);
  } catch {
    // Fall through — buildSession reports the state it can see.
  }
  return buildSession();
}
