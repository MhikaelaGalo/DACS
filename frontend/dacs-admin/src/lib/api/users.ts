/*
 * User Management endpoints (list/read: Owner + IT Staff; create/role
 * changes: Owner only; status changes: Owner + IT Staff). Mirrors
 * back end/src/modules/users.
 *
 * Users carry displayName/phoneNumber server-side (displayName is
 * refreshed from the Google profile on every sign-in); the fallback
 * chain below covers rows that predate those columns.
 */
import { CHOOSER_ACCOUNTS, ROLE_BY_LABEL, ROLE_LABELS, type StaffRole } from "../auth";
import { api } from "../api";
import type { StaffUserRow } from "@/types/admin";

export type ApiUserRole =
  | "OWNER_EXECUTIVE"
  | "IT_STAFF"
  | "ADMINISTRATIVE_STAFF"
  | "CLIENT_FARMER";

export interface ApiUser {
  id: string;
  email: string;
  role: ApiUserRole;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  displayName: string | null;
  phoneNumber: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  customerProfile?: {
    id: string;
    customerNumber: string;
    firstName: string;
    lastName: string;
    archivedAt: string | null;
  } | null;
}

export const FARMER_ROLE_LABEL = "Farmer";

export function roleLabelFor(role: ApiUserRole): string {
  if (role === "CLIENT_FARMER") return FARMER_ROLE_LABEL;
  return ROLE_LABELS[role as StaffRole] ?? role;
}

export function roleEnumForLabel(label: string): ApiUserRole | null {
  if (label === FARMER_ROLE_LABEL) return "CLIENT_FARMER";
  return ROLE_BY_LABEL[label] ?? null;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function displayNameFor(user: ApiUser): string {
  if (user.displayName) return user.displayName;
  const known = CHOOSER_ACCOUNTS.find(
    (account) => account.email.toLowerCase() === user.email.toLowerCase()
  );
  if (known) return known.name;
  if (user.customerProfile) {
    return `${user.customerProfile.firstName} ${user.customerProfile.lastName}`.trim();
  }
  return nameFromEmail(user.email);
}

function lastLoginLabel(lastLoginAt: string | null): string {
  if (!lastLoginAt) return "Never";
  const date = new Date(lastLoginAt);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function toStaffUserRow(user: ApiUser): StaffUserRow {
  return {
    id: user.id,
    name: displayNameFor(user),
    email: user.email,
    phoneNumber: user.phoneNumber ?? "",
    role: roleLabelFor(user.role),
    status: user.status,
    lastLogin: lastLoginLabel(user.lastLoginAt),
    avatarUrl: "/dacs-logo.png",
  };
}

export async function listUsers(): Promise<ApiUser[]> {
  const response = await api.get<{ data: ApiUser[] }>("/api/users");
  return response.data;
}

/*
 * Pre-authorize a staff member by their real Google email. The backend
 * creates the users row with the given role and ACTIVE status; the
 * person gains access the first time they complete Google sign-in.
 */
export async function createUser(input: {
  firstName?: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  role: ApiUserRole;
}): Promise<ApiUser> {
  const response = await api.post<{ data: ApiUser }>("/api/users", input);
  return response.data;
}

export async function updateUserRole(
  userId: string,
  role: ApiUserRole
): Promise<void> {
  await api.patch(`/api/users/${userId}/role`, { role });
}

export async function updateUserStatus(
  userId: string,
  status: "ACTIVE" | "SUSPENDED" | "DISABLED"
): Promise<void> {
  await api.patch(`/api/users/${userId}/status`, { status });
}
