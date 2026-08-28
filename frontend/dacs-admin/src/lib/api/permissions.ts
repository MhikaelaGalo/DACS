/*
 * Role-permission matrix endpoints. Mirrors
 * back end/src/modules/permissions.
 *
 * The API speaks backend UserRole ENUM values
 * (OWNER_EXECUTIVE/ADMINISTRATIVE_STAFF/IT_STAFF); the admin UI keys
 * its matrix by display labels (Owner/Administrative Staff/Staff) —
 * translation happens here. Grants for the three system roles are
 * server-authoritative; custom roles remain a cosmetic, client-only
 * concept (the backend's role set is a fixed enum) and never gate
 * anything.
 *
 * The effective matrix is also mirrored into the existing
 * localStorage key so the (admin) layout's synchronous page gating
 * (roleHasAccess) keeps working — that key is a CACHE of server truth,
 * refreshed on app load and after every matrix change.
 */
import { ROLE_BY_LABEL, ROLE_LABELS, type StaffRole } from "../auth";
import { api } from "../api";
import { getPermissions, savePermissions, type PermissionState } from "../permissions";

export interface ApiPermissionMatrix {
  /* Backend enum values. */
  roles: string[];
  modules: string[];
  grants: Record<string, Record<string, boolean>>;
}

/* Server (enum-keyed) grants merged over the cached label-keyed state,
   preserving any client-only custom-role columns. */
function mergeIntoState(matrix: ApiPermissionMatrix): PermissionState {
  const state = getPermissions();
  const grants: PermissionState["grants"] = { ...state.grants };
  for (const permissionModule of matrix.modules) {
    grants[permissionModule] = { ...(grants[permissionModule] ?? {}) };
    for (const roleEnum of matrix.roles) {
      const label = ROLE_LABELS[roleEnum as StaffRole];
      if (!label) continue;
      grants[permissionModule][label] =
        matrix.grants[permissionModule]?.[roleEnum] ?? true;
    }
  }
  const next: PermissionState = { roles: state.roles, grants };
  savePermissions(next);
  return next;
}

export async function fetchPermissionMatrix(): Promise<PermissionState> {
  const response = await api.get<{ data: ApiPermissionMatrix }>(
    "/api/permissions"
  );
  return mergeIntoState(response.data);
}

export async function updatePermission(
  roleLabel: string,
  permissionModule: string,
  allowed: boolean
): Promise<PermissionState> {
  const roleEnum = ROLE_BY_LABEL[roleLabel];
  if (!roleEnum) {
    throw new Error(`"${roleLabel}" is not a server-backed role.`);
  }
  const response = await api.patch<{ data: ApiPermissionMatrix }>(
    "/api/permissions",
    { updates: [{ role: roleEnum, permissionModule, allowed }] }
  );
  return mergeIntoState(response.data);
}

/* App-load cache refresh; failures leave the last-known cache alone. */
export async function refreshPermissionCache(): Promise<void> {
  try {
    await fetchPermissionMatrix();
  } catch {
    /* Offline or unauthorized — the cached grants keep gating. */
  }
}
