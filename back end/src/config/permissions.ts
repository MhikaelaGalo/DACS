/*
 * DACS permission matrix (code-based, per the tracker decision).
 *
 * One place defines which roles may use each User Management capability.
 * Future modules (orders, payments, seminars...) should add their own
 * sections here instead of hard-coding role lists in routes.
 */
export const USER_MANAGEMENT_ACCESS = {
  viewUsers: ["OWNER_EXECUTIVE", "IT_STAFF"],
  viewUser: ["OWNER_EXECUTIVE", "IT_STAFF"],
  /* Creating a user assigns a role, so it is as sensitive as changeRole. */
  createUser: ["OWNER_EXECUTIVE"],
  changeRole: ["OWNER_EXECUTIVE"],
  changeStatus: ["OWNER_EXECUTIVE", "IT_STAFF"],
} as const;

/*
 * The audit trail is Owner-only, matching the admin frontend's
 * Settings tab gating (Audit Logs is an OWNER-only tab).
 */
export const AUDIT_LOG_ACCESS = {
  viewLogs: ["OWNER_EXECUTIVE"],
} as const;

/*
 * ---------- Configurable role-permission matrix ----------
 *
 * The Settings > Roles and Permission screen configures which admin
 * MODULES (pages) each staff role may use. These are frontend page
 * gates; the hard route guards in this file and in the routers are the
 * security boundary and are never weakened by matrix rows.
 *
 * Roles are the fixed DACS UserRole enum — the matrix cannot invent
 * roles, and OWNER_EXECUTIVE always has every module so administrators
 * can never lock themselves out.
 */
export const PERMISSION_MODULES = [
  "Dashboard",
  "Customer Information",
  "Add Customer",
  "Delete Customer",
  "User Management",
  "Forms",
  "Historical Data",
  "Settings",
  "Audit Logs",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

/* The staff roles the matrix configures (farmers never see admin pages). */
export const MATRIX_ROLES = [
  "OWNER_EXECUTIVE",
  "ADMINISTRATIVE_STAFF",
  "IT_STAFF",
] as const;

export type MatrixRole = (typeof MATRIX_ROLES)[number];

/*
 * Code defaults, mirroring the admin frontend's defaultPermissions():
 * everything allowed except the modules the Figma role flow denies to
 * IT staff plus User Management for Administrative Staff. Database rows
 * override these per (role, module).
 */
const DENIED_BY_DEFAULT: ReadonlyArray<[MatrixRole, PermissionModule]> = [
  ["IT_STAFF", "Delete Customer"],
  ["ADMINISTRATIVE_STAFF", "User Management"],
  ["IT_STAFF", "User Management"],
  ["IT_STAFF", "Forms"],
  ["IT_STAFF", "Historical Data"],
  ["IT_STAFF", "Audit Logs"],
];

export function defaultPermissionGrants(): Record<
  PermissionModule,
  Record<MatrixRole, boolean>
> {
  const grants = {} as Record<PermissionModule, Record<MatrixRole, boolean>>;

  for (const permissionModule of PERMISSION_MODULES) {
    grants[permissionModule] = {
      OWNER_EXECUTIVE: true,
      ADMINISTRATIVE_STAFF: true,
      IT_STAFF: true,
    };
  }

  for (const [role, permissionModule] of DENIED_BY_DEFAULT) {
    grants[permissionModule][role] = false;
  }

  return grants;
}

/*
 * Managing the matrix matches the frontend's tab access: Owner and
 * Administrative Staff. Every STAFF session may READ it, though — the
 * admin frontend gates its pages on the effective matrix, so an IT
 * Staff session must be able to learn its own grants (it still cannot
 * change anything). Farmers can neither read nor change it.
 */
export const ROLE_PERMISSION_ACCESS = {
  viewMatrix: ["OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF", "IT_STAFF"],
  updateMatrix: ["OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"],
} as const;
