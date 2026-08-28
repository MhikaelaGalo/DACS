/*
 * Role-permission matrix (Settings > Roles and Permission). The same
 * state drives the actual page gating, so toggling "Forms" for Staff in
 * the matrix immediately changes what a Staff session can open.
 * Integration swap: GET/PUT a permissions endpoint instead of storage.
 */
import { readStorage, STORAGE_KEYS, writeStorage } from "./storage";

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

export const DEFAULT_ROLES = ["Owner", "Administrative Staff", "Staff"] as const;

export interface PermissionState {
  roles: string[];
  /* grants[module][role] = true when that role can use the module */
  grants: Record<string, Record<string, boolean>>;
}

/*
 * Defaults follow the Figma role flow: Staff is denied Forms and
 * Historical Data (the Access Denied screens), plus the owner-side
 * modules the matrix mockup leaves unchecked.
 */
export function defaultPermissions(): PermissionState {
  const grants: Record<string, Record<string, boolean>> = {};
  for (const permissionModule of PERMISSION_MODULES) {
    grants[permissionModule] = {
      Owner: true,
      "Administrative Staff": true,
      Staff: true,
    };
  }
  grants["Delete Customer"].Staff = false;
  grants["User Management"]["Administrative Staff"] = false;
  grants["User Management"].Staff = false;
  grants["Forms"].Staff = false;
  grants["Historical Data"].Staff = false;
  grants["Audit Logs"].Staff = false;
  return { roles: [...DEFAULT_ROLES], grants };
}

export function getPermissions(): PermissionState {
  return readStorage<PermissionState>(
    STORAGE_KEYS.permissions,
    defaultPermissions()
  );
}

export function savePermissions(state: PermissionState): void {
  writeStorage(STORAGE_KEYS.permissions, state);
}

export function roleHasAccess(
  roleLabel: string,
  permissionModule: PermissionModule
): boolean {
  const state = getPermissions();
  return state.grants[permissionModule]?.[roleLabel] ?? true;
}
