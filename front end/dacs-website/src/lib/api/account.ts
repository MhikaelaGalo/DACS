/*
 * Typed wrappers for the farmer account surface: auth sync/me, the
 * customer profile (incl. profile-image upload) and farms. Shapes mirror
 * the backend responses field for field (back end/src/modules/...).
 */
import { api } from "../api";

/* POST /api/auth/sync + GET /api/auth/me -> data */
export interface ApiAccount {
  id: string;
  email: string;
  /** Only present on GET /api/auth/me (read from the token claim). */
  emailVerified?: boolean;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  lastLoginAt: string | null;
}

/* Farm rows embedded in the profile payload and GET /api/farms/me. */
export interface ApiFarm {
  id: string;
  farmName: string;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  region: string | null;
  postalCode: string | null;
  isPrimary: boolean;
  farmLogoUrl: string | null;
  createdAt: string;
}

/* GET /api/customers/me -> data */
export interface ApiCustomerProfile {
  id: string;
  customerNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  occupation: string | null;
  phoneNumber: string | null;
  contactEmail: string | null;
  facebookName: string | null;
  addressLine1: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
  region: string | null;
  postalCode: string | null;
  profileImageUrl: string | null;
  farms?: ApiFarm[];
}

export interface ProfileFields {
  firstName?: string;
  lastName?: string;
  middleName?: string;
  suffix?: string;
  occupation?: string;
  phoneNumber?: string;
  contactEmail?: string;
  facebookName?: string;
  addressLine1?: string;
  barangay?: string;
  cityMunicipality?: string;
  province?: string;
  region?: string;
  postalCode?: string;
}

export interface FarmFields {
  farmName?: string;
  addressLine1?: string;
  barangay?: string;
  cityMunicipality?: string;
  province?: string;
  region?: string;
  postalCode?: string;
  isPrimary?: boolean;
}

export async function syncAccount(): Promise<ApiAccount> {
  const response = await api.post<{ data: ApiAccount }>("/api/auth/sync");
  return response.data;
}

export async function getAccount(): Promise<ApiAccount> {
  const response = await api.get<{ data: ApiAccount }>("/api/auth/me");
  return response.data;
}

export async function getMyProfile(): Promise<ApiCustomerProfile> {
  const response = await api.get<{ data: ApiCustomerProfile }>(
    "/api/customers/me"
  );
  return response.data;
}

export async function createMyProfile(
  fields: ProfileFields
): Promise<ApiCustomerProfile> {
  const response = await api.post<{ data: ApiCustomerProfile }>(
    "/api/customers/me",
    fields
  );
  return response.data;
}

export async function updateMyProfile(
  fields: ProfileFields
): Promise<ApiCustomerProfile> {
  const response = await api.patch<{ data: ApiCustomerProfile }>(
    "/api/customers/me",
    fields
  );
  return response.data;
}

export async function uploadProfileImage(
  file: File
): Promise<ApiCustomerProfile> {
  const formData = new FormData();
  formData.append("image", file);
  const response = await api.upload<{ data: ApiCustomerProfile }>(
    "/api/customers/me/profile-image",
    formData,
    "PUT"
  );
  return response.data;
}

export async function listMyFarms(): Promise<ApiFarm[]> {
  const response = await api.get<{ data: ApiFarm[] }>("/api/farms/me");
  return response.data;
}

export async function createFarm(fields: FarmFields): Promise<ApiFarm> {
  const response = await api.post<{ data: ApiFarm }>("/api/farms", fields);
  return response.data;
}

export async function updateFarm(
  farmId: string,
  fields: FarmFields
): Promise<ApiFarm> {
  const response = await api.patch<{ data: ApiFarm }>(
    `/api/farms/${farmId}`,
    fields
  );
  return response.data;
}

/** Joins the granular PH address columns into one display string. */
export function composeAddress(
  parts: Array<string | null | undefined>
): string {
  return parts.filter(Boolean).join(", ");
}
