/**
 * The signed-in customer session, composed from the Firebase account and
 * the DACS backend (GET /api/auth/me + GET /api/customers/me, which
 * includes the farms). Display strings (fullName, completeAddress,
 * farmAddress) are joined from the backend's granular columns.
 */
export interface User {
  /** Firebase uid — also scopes the per-account localStorage keys. */
  id: string;
  fullName: string;
  email: string;
  /** Firebase email verification state; backend writes require true. */
  emailVerified: boolean;
  /** False until the customer profile row exists (onboarding pending). */
  hasProfile: boolean;
  contactNumber: string;
  completeAddress: string;
  avatarUrl: string;
  facebookName?: string;
  occupation?: string;
  contactEmail?: string;
  /** Backend identifiers (present once the profile exists). */
  customerNumber?: string;
  profileId?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  /** Primary farm summary shown on the Farm Details page. */
  primaryFarmId?: string;
  farmName?: string;
  farmAddress?: string;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  contactNumber: string;
  completeAddress: string;
  farmName: string;
  farmAddress: string;
}

export interface SignInInput {
  email: string;
  password: string;
}
