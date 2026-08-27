"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";

import { getSession, ROLE_BY_LABEL, type StaffRole, type StaffSession } from "@/lib/auth";
import { fetchPermissionMatrix, updatePermission } from "@/lib/api/permissions";

import {
  applyQuery,
  emptyQuery,
  FilterButton,
  type TableColumn,
  type TableQuery,
} from "@/components/ui/FilterControls";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TableShell, Td, Th } from "@/components/ui/Table";
import { listAuditLogs } from "@/lib/api/auditLogs";
import {
  getNotificationPreferences,
  NOTIFICATION_ENUM_BY_LABEL,
  NOTIFICATION_TYPE_LABELS,
  updateNotificationPreferences,
} from "@/lib/api/notifications";
import { errorMessage } from "@/lib/api";
import {
  createUser as createUserRequest,
  FARMER_ROLE_LABEL,
  listUsers,
  roleEnumForLabel,
  toStaffUserRow,
  updateUserRole,
  updateUserStatus,
} from "@/lib/api/users";
import { appendAudit } from "@/lib/audit";
import { PRIVACY_POLICY_URL, TERMS_AND_CONDITIONS_URL } from "@/lib/legal";
import {
  DEFAULT_ROLES,
  defaultPermissions,
  PERMISSION_MODULES,
  type PermissionState,
} from "@/lib/permissions";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import { usePersistentState } from "@/lib/stores";
import type {
  AuditLogRow,
  CompanyInfo,
  StaffUserRow,
  UserInfo,
} from "@/types/admin";

const TABS = [
  "General",
  "User Management",
  "Roles and Permission",
  "System Preferences",
  "Notifications",
  "Data Management",
  "Audit Logs",
  "About System",
] as const;

type Tab = (typeof TABS)[number];

/*
 * Hard role checks per Settings section (deliberately independent of
 * the configurable permission matrix — the matrix must never be able
 * to lock its own owners out). Tabs missing from the map are open to
 * every staff session. User Management, Data Management and Audit Logs
 * stay Owner-only; Roles and Permission is administrative: Owner and
 * Administrative Staff have access, IT Staff never see or open it.
 */
const TAB_ACCESS: Partial<Record<Tab, StaffRole[]>> = {
  "User Management": ["OWNER_EXECUTIVE"],
  "Data Management": ["OWNER_EXECUTIVE"],
  "Audit Logs": ["OWNER_EXECUTIVE"],
  "Roles and Permission": ["OWNER_EXECUTIVE", "ADMINISTRATIVE_STAFF"],
};

function canAccessTab(role: StaffRole | undefined, tab: Tab): boolean {
  const allowedRoles = TAB_ACCESS[tab];
  return !allowedRoles || (role !== undefined && allowedRoles.includes(role));
}

interface Preferences {
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY";
  timeFormat: "12-hour" | "24-hour";
  landingPage: "Dashboard" | "Customer Information" | "Orders";
}

/*
 * Figma notification checklist labels. Six map to real backend
 * notification types; "Submitted Form" and "Inventory Running Low"
 * describe notifications the system does not send yet and render as
 * disabled rows until those features exist.
 */
const NOTIFICATION_TYPES = [
  "New Customer Registration",
  "New Order",
  "New Inquiry Ticket",
  "Order Auto-Cancelled (No Payment)",
  "Certification Approved",
  "Certification Expiring",
  "Submitted Form",
  "Inventory Running Low",
] as const;

interface NotifPrefs {
  enabled: boolean;
  types: Record<string, boolean>;
}

const DEFAULT_COMPANY: CompanyInfo = {
  companyName: "Dominant Asia Poultry Genetics",
  businessAddress: "Rizal, Philippines",
  contactNumber: "+63 917 895 1105",
  emailAddress: "dczparentstocks@dominantasia.com",
  facebookPage: "https://www.facebook.com/dominantasialivestockgenetics/",
  website: "https://www.dominantasia.com/home/",
};

const DEFAULT_USER: UserInfo = {
  fullName: "Erwin Joseph Cruz",
  position: "Owner",
  emailAddress: "erwinjoseph.cruz@dominantasia.com",
  contactNumber: "+63 912 345 6789",
};

const USER_COLUMNS: Array<TableColumn<StaffUserRow>> = [
  { key: "name", label: "Name", get: (row) => row.name },
  { key: "email", label: "Email", get: (row) => row.email },
  { key: "role", label: "Role", get: (row) => row.role },
  { key: "status", label: "Status", get: (row) => row.status },
  { key: "lastLogin", label: "Last Login", get: (row) => row.lastLogin },
];

const LOG_COLUMNS: Array<TableColumn<AuditLogRow>> = [
  { key: "createdAt", label: "Timestamp", get: (row) => row.createdAt },
  { key: "roleLabel", label: "User", get: (row) => row.roleLabel },
  { key: "module", label: "Module", get: (row) => row.module },
  { key: "action", label: "Status", get: (row) => row.action },
  { key: "description", label: "Description", get: (row) => row.description },
];

/*
 * Roles every DACS deployment depends on — they can never be deleted
 * from the matrix (the backend's UserRole enum mirrors them).
 */
const PROTECTED_ROLES: string[] = [...DEFAULT_ROLES];

/* Underlined info row (Figma General tab). Module-scoped so its inputs
   keep their identity (and focus) across re-renders. */
const InfoRow = ({
  label,
  value,
  editing,
  onChange,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}) => (
  <div className="grid grid-cols-1 items-baseline gap-1 py-2.5 sm:grid-cols-[minmax(150px,200px)_1fr] sm:gap-6">
    <span className="text-lg font-bold">{label}</span>
    {editing ? (
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-b border-dacs-dark bg-dacs-light/40 px-1 py-0.5 outline-none"
      />
    ) : (
      <span className="break-all underline underline-offset-4">{value}</span>
    )}
  </div>
);

export default function SettingsPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("General");
  const [session, setSession] = useState<StaffSession | null>(null);

  useEffect(() => {
    setSession(getSession());
  }, []);

  /*
   * Role-restricted sections (see TAB_ACCESS): the tab is hidden from
   * the rail, and a session that lands on a forbidden tab anyway (role
   * switched mid-session, stale state) is redirected to General — the
   * section's content additionally refuses to render without access.
   */
  const visibleTabs = TABS.filter((entry) => canAccessTab(session?.role, entry));
  const canManageRoles = Boolean(
    session && canAccessTab(session.role, "Roles and Permission")
  );

  useEffect(() => {
    if (session && !canAccessTab(session.role, tab)) {
      setTab("General");
    }
  }, [session, tab]);

  /* General */
  const [company, setCompany] = usePersistentState<CompanyInfo>(
    `${STORAGE_KEYS.generalInfo}.company`,
    DEFAULT_COMPANY
  );
  const [userInfo, setUserInfo] = usePersistentState<UserInfo>(
    `${STORAGE_KEYS.generalInfo}.user`,
    DEFAULT_USER
  );
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingUser, setEditingUser] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const companyLogoInput = useRef<HTMLInputElement>(null);
  const userPhotoInput = useRef<HTMLInputElement>(null);

  function readImage(file: File, apply: (dataUrl: string) => void) {
    const reader = new FileReader();
    reader.onload = () => apply(String(reader.result));
    reader.readAsDataURL(file);
  }

  /*
   * User Management — server-backed (GET /api/users). Only Owners can
   * list users on the backend, matching the Owner-only tab access.
   */
  const [users, setUsers] = useState<StaffUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userQuery, setUserQuery] = useState<TableQuery>(emptyQuery("name"));
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<StaffUserRow | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [pendingUserDelete, setPendingUserDelete] = useState<StaffUserRow | null>(
    null
  );
  const [newUser, setNewUser] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    role: "",
    avatar: "",
  });
  const newUserPhotoInput = useRef<HTMLInputElement>(null);

  async function refreshUsers() {
    try {
      const data = await listUsers();
      setUsers(data.map(toStaffUserRow));
      setUsersError(null);
    } catch (error) {
      setUsersError(errorMessage(error, "Unable to load users. Please try again."));
    }
  }

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.users);
    if (!session || session.role !== "OWNER_EXECUTIVE") return;
    let cancelled = false;
    setUsersLoading(true);
    void listUsers()
      .then((data) => {
        if (cancelled) return;
        setUsers(data.map(toStaffUserRow));
        setUsersError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setUsersError(
          errorMessage(error, "Unable to load users. Please try again.")
        );
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  /* Roles and Permission */
  const [permissions, setPermissions] = usePersistentState<PermissionState>(
    STORAGE_KEYS.permissions,
    defaultPermissions()
  );
  const [permissionsSaved, setPermissionsSaved] = useState(false);
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [pendingRoleDelete, setPendingRoleDelete] = useState<string | null>(null);

  /* System-role grants are server truth — refresh them (merged over
     any client-only custom-role columns) whenever the matrix is
     manageable in this session. */
  useEffect(() => {
    if (!session || !canAccessTab(session.role, "Roles and Permission")) return;
    let cancelled = false;
    void fetchPermissionMatrix()
      .then((state) => {
        if (!cancelled) setPermissions(state);
      })
      .catch(() => {
        /* Cached grants keep rendering; toggles surface their own errors. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /* System Preferences */
  const [preferences, setPreferences] = usePersistentState<Preferences>(
    STORAGE_KEYS.preferences,
    { dateFormat: "MM/DD/YYYY", timeFormat: "24-hour", landingPage: "Dashboard" }
  );
  const [preferencesSaved, setPreferencesSaved] = useState(false);

  /*
   * Notifications — preferences are per-user server state
   * (GET/PATCH /api/notifications/preferences). The master switch is a
   * bulk toggle over every server-backed type.
   */
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>({
    enabled: true,
    types: {},
  });
  const [notifSaved, setNotifSaved] = useState(false);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.notifPrefs);
    let cancelled = false;
    void getNotificationPreferences()
      .then((preferences) => {
        if (cancelled) return;
        const types = Object.fromEntries(
          preferences.map((preference) => [
            NOTIFICATION_TYPE_LABELS[preference.type],
            preference.enabled,
          ])
        );
        setNotifPrefs({
          enabled: preferences.some((preference) => preference.enabled),
          types,
        });
      })
      .catch(() => {
        /* Toggle errors surface individually below. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleNotifMaster() {
    const nextEnabled = !notifPrefs.enabled;
    const updates = (
      Object.keys(NOTIFICATION_ENUM_BY_LABEL) as string[]
    ).map((label) => ({
      type: NOTIFICATION_ENUM_BY_LABEL[label],
      enabled: nextEnabled,
    }));
    const previous = notifPrefs;
    setNotifPrefs({
      enabled: nextEnabled,
      types: Object.fromEntries(
        Object.keys(NOTIFICATION_ENUM_BY_LABEL).map((label) => [label, nextEnabled])
      ),
    });
    void updateNotificationPreferences(updates).catch((error) => {
      setNotifPrefs(previous);
      showToast(
        errorMessage(error, "Unable to save notification settings. Please try again."),
        "error"
      );
    });
  }

  function toggleNotifType(label: string) {
    const type = NOTIFICATION_ENUM_BY_LABEL[label];
    if (!type) return;
    const next = !notifPrefs.types[label];
    const previous = notifPrefs;
    setNotifPrefs({
      ...notifPrefs,
      types: { ...notifPrefs.types, [label]: next },
    });
    void updateNotificationPreferences([{ type, enabled: next }]).catch((error) => {
      setNotifPrefs(previous);
      showToast(
        errorMessage(error, "Unable to save notification settings. Please try again."),
        "error"
      );
    });
  }

  /*
   * Audit Logs — the backend activity trail (GET /api/audit-logs,
   * Owner-only, read-only by design). The tab shows the latest 100
   * entries; search/filter stay client-side over that window.
   */
  const [logSearch, setLogSearch] = useState("");
  const [logQuery, setLogQuery] = useState<TableQuery>(emptyQuery("roleLabel"));
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "Audit Logs" || session?.role !== "OWNER_EXECUTIVE") return;
    let cancelled = false;
    setAuditLoading(true);
    void listAuditLogs({ pageSize: 100 })
      .then(({ rows }) => {
        if (cancelled) return;
        setAuditRows(rows);
        setAuditError(null);
      })
      .catch((error) => {
        if (!cancelled) {
          setAuditError(
            errorMessage(error, "Unable to load audit logs. Please try again.")
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, session]);

  const allLogs = auditRows;
  const searchedLogs = allLogs.filter((log) =>
    `${log.userEmail} ${log.roleLabel} ${log.module} ${log.action} ${log.description}`
      .toLowerCase()
      .includes(logSearch.toLowerCase())
  );
  const filteredLogs = applyQuery(searchedLogs, LOG_COLUMNS, logQuery);

  const searchedUsers = users.filter((user) =>
    `${user.name} ${user.email} ${user.role}`
      .toLowerCase()
      .includes(userSearch.toLowerCase())
  );
  const filteredUsers = applyQuery(searchedUsers, USER_COLUMNS, userQuery);

  function flash(setter: (value: boolean) => void) {
    setter(true);
    window.setTimeout(() => setter(false), 2500);
  }

  /*
   * Pre-authorize a staff member (POST /api/users): the Owner enters
   * the person's real Google email and role; the account becomes usable
   * the first time that person completes Google sign-in. No password is
   * ever created or stored by DACS.
   */
  async function createUser() {
    if (savingUser) return;
    if (!newUser.firstName.trim() || !newUser.email.trim() || !newUser.role) return;

    const role = roleEnumForLabel(newUser.role);
    if (!role) {
      showToast(
        `The "${newUser.role}" role is not server-backed yet. Choose Owner, Administrative Staff, Staff, or Farmer.`,
        "error"
      );
      return;
    }

    setSavingUser(true);
    try {
      await createUserRequest({
        firstName: newUser.firstName.trim(),
        lastName: newUser.lastName.trim() || undefined,
        email: newUser.email.trim(),
        phoneNumber: newUser.phoneNumber.trim() || undefined,
        role,
      });
      appendAudit(
        "Users",
        "USER_CREATED",
        `Pre-authorized ${newUser.email.trim()} (${newUser.role}).`
      );
      showToast("User added. They can now sign in with their Google account.");
      setAddingUser(false);
      setNewUser({ firstName: "", lastName: "", email: "", phoneNumber: "", role: "", avatar: "" });
      await refreshUsers();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to add this user. Please try again."),
        "error"
      );
    } finally {
      setSavingUser(false);
    }
  }

  async function saveUserEdit() {
    if (!userDraft || savingUser) return;
    const original = users.find((entry) => entry.id === userDraft.id);
    if (!original) return;

    const roleChanged = userDraft.role !== original.role;
    const statusChanged = userDraft.status !== original.status;
    if (!roleChanged && !statusChanged) {
      setEditingUserId(null);
      setUserDraft(null);
      return;
    }

    if (roleChanged && !roleEnumForLabel(userDraft.role)) {
      showToast(
        `The "${userDraft.role}" role is not server-backed yet. Choose Owner, Administrative Staff, Staff, or Farmer.`,
        "error"
      );
      return;
    }

    setSavingUser(true);
    try {
      if (roleChanged) {
        await updateUserRole(
          userDraft.id,
          roleEnumForLabel(userDraft.role)!
        );
      }
      if (statusChanged) {
        await updateUserStatus(userDraft.id, userDraft.status);
      }
      appendAudit("Users", "USER_UPDATED", `Edited user ${userDraft.name}.`);
      showToast("User updated successfully.");
      setEditingUserId(null);
      setUserDraft(null);
      await refreshUsers();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to update this user. Please try again."),
        "error"
      );
    } finally {
      setSavingUser(false);
    }
  }

  /*
   * "Delete" deactivates: the backend keeps the account and sets its
   * status to DISABLED (PATCH /api/users/:id/status) — Firebase and
   * PostgreSQL records are never destroyed. Blocked client-side for the
   * signed-in account and Owner accounts; the backend enforces the same
   * rules (self-change 403, IT restrictions) regardless.
   */
  function userDeletionBlockedReason(user: StaffUserRow): string | null {
    if (session && user.email.toLowerCase() === session.email.toLowerCase()) {
      return "Unable to delete this user. You are currently signed in with this account.";
    }
    if (user.role === "Owner") {
      return "Unable to delete this user. Owner accounts are protected.";
    }
    if (user.status === "DISABLED") {
      return "This account is already disabled.";
    }
    return null;
  }

  function requestUserDelete(user: StaffUserRow) {
    const blocked = userDeletionBlockedReason(user);
    if (blocked) {
      showToast(blocked, "error");
      return;
    }
    setPendingUserDelete(user);
  }

  async function deleteUser(user: StaffUserRow) {
    try {
      await updateUserStatus(user.id, "DISABLED");
      if (editingUserId === user.id) {
        setEditingUserId(null);
        setUserDraft(null);
      }
      appendAudit(
        "Users",
        "USER_DISABLED",
        `Disabled user ${user.name} (${user.email}).`
      );
      showToast("User has been disabled and can no longer sign in.");
      await refreshUsers();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to disable this user. Please try again."),
        "error"
      );
    } finally {
      setPendingUserDelete(null);
    }
  }

  /*
   * Every matrix mutation re-checks access: with the tab hidden and the
   * section unrendered these are unreachable for IT Staff through the
   * UI, but the guard keeps a stale or hand-held call from writing.
   *
   * System-role grants live on the backend (PATCH /api/permissions,
   * persisted per toggle exactly like the old per-toggle localStorage
   * write-through); custom-role columns are client-only cosmetics —
   * they never gate anything and the backend's role set is fixed.
   */
  function toggleGrant(permissionModule: string, role: string) {
    if (!canManageRoles) return;
    if (role === "Owner") {
      /* Mirror of the backend rule — the matrix can never lock out
         its own administrators. */
      showToast(
        "Owner permissions cannot be modified — the Owner always has full access.",
        "error"
      );
      return;
    }
    if (ROLE_BY_LABEL[role]) {
      const next = !permissions.grants[permissionModule]?.[role];
      void updatePermission(role, permissionModule, next)
        .then((state) => setPermissions(state))
        .catch((error) =>
          showToast(
            errorMessage(error, "Unable to save this permission. Please try again."),
            "error"
          )
        );
    } else {
      setPermissions((current) => ({
        ...current,
        grants: {
          ...current.grants,
          [permissionModule]: {
            ...current.grants[permissionModule],
            [role]: !current.grants[permissionModule]?.[role],
          },
        },
      }));
    }
    setPermissionsSaved(false);
  }

  function addRole() {
    if (!canManageRoles) return;
    const role = newRoleName.trim();
    if (!role || permissions.roles.includes(role)) return;
    setPermissions((current) => ({
      roles: [...current.roles, role],
      grants: Object.fromEntries(
        Object.entries(current.grants).map(([module, grants]) => [
          module,
          { ...grants, [role]: false },
        ])
      ),
    }));
    appendAudit("Users", "ROLE_CREATED", `Added role "${role}".`);
    setAddingRole(false);
    setNewRoleName("");
  }

  /*
   * Custom roles can be deleted; the DACS system roles (Owner,
   * Administrative Staff, Staff) cannot, and a role with users still
   * assigned is blocked so nobody is left with invalid permissions.
   */
  function requestRoleDelete(role: string) {
    if (!canManageRoles) return;
    if (PROTECTED_ROLES.includes(role)) {
      showToast(`"${role}" is a system role and cannot be deleted.`, "error");
      return;
    }
    const assigned = users.filter((user) => user.role === role).length;
    if (assigned > 0) {
      showToast(
        `Unable to delete "${role}". ${assigned} user${assigned === 1 ? " is" : "s are"} still assigned to it — reassign them first.`,
        "error"
      );
      return;
    }
    setPendingRoleDelete(role);
  }

  function deleteRole(role: string) {
    if (!canManageRoles) return;
    try {
      setPermissions((current) => ({
        roles: current.roles.filter((entry) => entry !== role),
        grants: Object.fromEntries(
          Object.entries(current.grants).map(([module, grants]) => {
            const next = { ...grants };
            delete next[role];
            return [module, next];
          })
        ),
      }));
      appendAudit("Users", "ROLE_DELETED", `Deleted role "${role}".`);
      showToast("Role deleted successfully.");
    } catch {
      showToast("Unable to delete this role. Please try again.", "error");
    } finally {
      setPendingRoleDelete(null);
    }
  }

  function exportDatabase() {
    const dump: Record<string, unknown> = {};
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      try {
        const raw = window.localStorage.getItem(key);
        dump[name] = raw ? JSON.parse(raw) : null;
      } catch {
        dump[name] = null;
      }
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dacs-database-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    appendAudit("Data", "DATABASE_EXPORTED", "Exported the database to JSON.");
  }

  /* Red-check option row (Figma System Preferences). */
  const OptionRow = ({
    label,
    selected,
    onSelect,
  }: {
    label: string;
    selected: boolean;
    onSelect: () => void;
  }) => (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center justify-between border-b border-dacs-light py-4 text-left hover:bg-dacs-light/40"
    >
      <span className="text-lg">{label}</span>
      {selected && <Check size={22} className="text-dacs-red" />}
    </button>
  );

  /* Red double-check permission mark (Figma Roles matrix). */
  const GrantMark = ({ granted, onToggle }: { granted: boolean; onToggle: () => void }) => (
    <button
      type="button"
      onClick={onToggle}
      aria-label={granted ? "Revoke access" : "Grant access"}
      className="mx-auto flex h-9 w-14 items-center justify-center rounded-lg hover:bg-dacs-light/70"
    >
      {granted ? (
        <span className="flex text-dacs-red">
          <Check size={20} strokeWidth={3} />
          <Check size={20} strokeWidth={3} className="-ml-2.5" />
        </span>
      ) : (
        <span className="text-dacs-light">—</span>
      )}
    </button>
  );

  return (
    <>
      <div className="mb-6 flex items-center gap-3 lg:mb-8 lg:gap-6">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Settings</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr] lg:gap-10">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {visibleTabs.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-1 py-2.5 text-left text-[15px] ${
                tab === entry
                  ? "border-dacs-dark font-bold"
                  : "border-transparent text-dacs-muted hover:text-dacs-dark"
              }`}
            >
              {entry}
            </button>
          ))}
        </nav>

        <div>
          {/* ------------------------------------------------ General */}
          {tab === "General" && (
            <div className="max-w-3xl">
              <h2 className="mb-6 text-2xl font-bold">Company Information</h2>
              <div className="flex flex-wrap items-start gap-6 sm:gap-10">
                <div className="relative shrink-0">
                  {company.logoImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={company.logoImage}
                      alt="Company logo"
                      className="h-[150px] w-[150px] rounded-lg border border-dacs-light object-contain"
                    />
                  ) : (
                    <Image
                      src="/dominant-asia-logo.png"
                      alt="Company logo"
                      width={150}
                      height={150}
                      className="rounded-lg border border-dacs-light"
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Edit company information"
                    onClick={() => setEditingCompany(!editingCompany)}
                    className="absolute -right-2 -top-2 rounded-full bg-white p-2 shadow-dacs-card hover:bg-red-50"
                  >
                    <Pencil size={16} className="text-dacs-red" />
                  </button>
                  {editingCompany && (
                    <button
                      type="button"
                      onClick={() => companyLogoInput.current?.click()}
                      className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 rounded-b-lg bg-black/60 py-2 text-xs font-semibold text-white hover:bg-black/75"
                    >
                      <Upload size={13} />
                      Change Logo
                    </button>
                  )}
                  <input
                    ref={companyLogoInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        readImage(file, (logoImage) =>
                          setCompany({ ...company, logoImage })
                        );
                      event.target.value = "";
                    }}
                  />
                </div>
                <div className="w-full min-w-[280px] flex-1">
                  <InfoRow label="Company Name" value={company.companyName} editing={editingCompany} onChange={(companyName) => setCompany({ ...company, companyName })} />
                  <InfoRow label="Business Address" value={company.businessAddress} editing={editingCompany} onChange={(businessAddress) => setCompany({ ...company, businessAddress })} />
                  <InfoRow label="Contact Number" value={company.contactNumber} editing={editingCompany} onChange={(contactNumber) => setCompany({ ...company, contactNumber })} />
                  <InfoRow label="Email Address" value={company.emailAddress} editing={editingCompany} onChange={(emailAddress) => setCompany({ ...company, emailAddress })} />
                  <InfoRow label="Facebook Page" value={company.facebookPage} editing={editingCompany} onChange={(facebookPage) => setCompany({ ...company, facebookPage })} />
                  <InfoRow label="Website" value={company.website} editing={editingCompany} onChange={(website) => setCompany({ ...company, website })} />
                </div>
              </div>

              <h2 className="mb-6 mt-12 text-2xl font-bold">User Information</h2>
              <div className="flex flex-wrap items-start gap-6 sm:gap-10">
                <div className="relative shrink-0">
                  {userInfo.photoImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userInfo.photoImage}
                      alt="User profile"
                      className="h-[150px] w-[150px] rounded-full border border-dacs-light object-cover"
                    />
                  ) : (
                    <Image
                      src="/user-profile.jpg"
                      alt="User profile"
                      width={150}
                      height={150}
                      className="rounded-full border border-dacs-light object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Edit user information"
                    onClick={() => setEditingUser(!editingUser)}
                    className="absolute -right-1 -top-1 rounded-full bg-white p-2 shadow-dacs-card hover:bg-red-50"
                  >
                    <Pencil size={16} className="text-dacs-red" />
                  </button>
                  {editingUser && (
                    <button
                      type="button"
                      onClick={() => userPhotoInput.current?.click()}
                      className="absolute inset-x-4 bottom-1 flex items-center justify-center gap-1.5 rounded-full bg-black/60 py-1.5 text-xs font-semibold text-white hover:bg-black/75"
                    >
                      <Upload size={13} />
                      Change Photo
                    </button>
                  )}
                  <input
                    ref={userPhotoInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        readImage(file, (photoImage) =>
                          setUserInfo({ ...userInfo, photoImage })
                        );
                      event.target.value = "";
                    }}
                  />
                </div>
                <div className="w-full min-w-[280px] flex-1">
                  <InfoRow label="Full Name" value={userInfo.fullName} editing={editingUser} onChange={(fullName) => setUserInfo({ ...userInfo, fullName })} />
                  <InfoRow label="Position" value={userInfo.position} editing={editingUser} onChange={(position) => setUserInfo({ ...userInfo, position })} />
                  <InfoRow label="Email Address" value={userInfo.emailAddress} editing={editingUser} onChange={(emailAddress) => setUserInfo({ ...userInfo, emailAddress })} />
                  <InfoRow label="Contact Number" value={userInfo.contactNumber} editing={editingUser} onChange={(contactNumber) => setUserInfo({ ...userInfo, contactNumber })} />
                </div>
              </div>

              <div className="mt-10 flex items-center justify-end gap-4">
                {generalSaved && (
                  <span className="text-sm font-medium text-green-700">Saved ✓</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setEditingCompany(false);
                    setEditingUser(false);
                    appendAudit("Settings", "GENERAL_INFO_UPDATED", "Saved company/user information.");
                    flash(setGeneralSaved);
                  }}
                  className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------- User Management */}
          {tab === "User Management" && !addingUser && (
            <div>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="relative min-w-[180px] max-w-[480px] flex-1">
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search User..."
                    className="w-full rounded-full border border-dacs-dark/40 py-2.5 pl-5 pr-11 text-sm italic outline-none focus:border-dacs-dark"
                  />
                  <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-dacs-dark" />
                </div>
                <div className="flex items-center gap-3">
                  <FilterButton
                    rows={users}
                    columns={USER_COLUMNS}
                    query={userQuery}
                    onChange={setUserQuery}
                  />
                  <button
                    type="button"
                    onClick={() => setAddingUser(true)}
                    className="flex items-center gap-1 rounded-2xl bg-dacs-dark px-7 py-3 font-semibold text-white hover:opacity-90"
                  >
                    <Plus size={16} />
                    Add User
                  </button>
                </div>
              </div>

              <TableShell>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Last Login</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={6}>
                        Loading users…
                      </Td>
                    </tr>
                  )}
                  {!usersLoading && usersError && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={6}>
                        {usersError}
                      </Td>
                    </tr>
                  )}
                  {!usersLoading && !usersError && filteredUsers.length === 0 && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={6}>
                        No users match the current search/filter.
                      </Td>
                    </tr>
                  )}
                  {!usersLoading &&
                    filteredUsers.map((user) => {
                    const isEditing = editingUserId === user.id && userDraft;
                    return (
                      <tr key={user.id}>
                        <Td>
                          {isEditing ? (
                            <input
                              value={userDraft.name}
                              disabled
                              title="Names come from the account's sign-in profile and can't be edited here."
                              className="border-b border-dacs-dark/30 text-center text-dacs-muted outline-none"
                            />
                          ) : (
                            <span className="font-medium underline underline-offset-4">
                              {user.name}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {isEditing ? (
                            <input
                              value={userDraft.email}
                              disabled
                              title="Email addresses come from the account's sign-in profile and can't be edited here."
                              className="w-56 border-b border-dacs-dark/30 text-center text-dacs-muted outline-none"
                            />
                          ) : (
                            <span className="underline underline-offset-4">{user.email}</span>
                          )}
                        </Td>
                        <Td>
                          {isEditing ? (
                            <select
                              value={userDraft.role}
                              onChange={(event) => setUserDraft({ ...userDraft, role: event.target.value })}
                              className="rounded-lg border border-dacs-dark/40 px-2 py-1"
                            >
                              {[...new Set([...permissions.roles, FARMER_ROLE_LABEL])].map((role) => (
                                <option key={role}>{role}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="underline underline-offset-4">{user.role}</span>
                          )}
                        </Td>
                        <Td>
                          {isEditing ? (
                            <select
                              value={userDraft.status}
                              onChange={(event) =>
                                setUserDraft({
                                  ...userDraft,
                                  status: event.target.value as StaffUserRow["status"],
                                })
                              }
                              className="rounded-lg border border-dacs-dark/40 px-2 py-1"
                            >
                              <option value="ACTIVE">Active</option>
                              <option value="SUSPENDED">Suspended</option>
                              <option value="DISABLED">Disabled</option>
                            </select>
                          ) : (
                            <span className="rounded-lg border border-dacs-dark/30 px-3 py-1 text-sm">
                              {user.status === "ACTIVE"
                                ? "Active"
                                : user.status === "SUSPENDED"
                                  ? "Suspended"
                                  : "Disabled"}
                            </span>
                          )}
                        </Td>
                        <Td>{user.lastLogin}</Td>
                        <Td>
                          {isEditing ? (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUserId(null);
                                setUserDraft(null);
                              }}
                              className="font-semibold text-dacs-muted underline hover:text-dacs-dark"
                            >
                              Cancel
                            </button>
                          ) : (
                            <span className="flex items-center justify-center gap-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingUserId(user.id);
                                  setUserDraft({ ...user });
                                }}
                                className="font-semibold underline hover:text-dacs-red"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => requestUserDelete(user)}
                                className={`font-semibold underline ${
                                  userDeletionBlockedReason(user)
                                    ? "text-dacs-muted/60 hover:text-dacs-muted"
                                    : "text-dacs-red hover:opacity-80"
                                }`}
                                title={
                                  userDeletionBlockedReason(user) ?? "Delete user"
                                }
                              >
                                Delete
                              </button>
                            </span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>

              {editingUserId && (
                <div className="mt-8 flex justify-end">
                  <button
                    type="button"
                    disabled={savingUser}
                    onClick={() => void saveUserEdit()}
                    className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {savingUser ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Add User form state (Figma: full-panel form) */}
          {tab === "User Management" && addingUser && (
            <div className="max-w-xl">
              {[
                { label: "First Name", key: "firstName" as const },
                { label: "Last Name", key: "lastName" as const },
                { label: "Email", key: "email" as const },
                { label: "Phone Number", key: "phoneNumber" as const },
              ].map(({ label, key }) => (
                <label key={key} className="mb-6 grid grid-cols-1 items-center gap-2 sm:grid-cols-[160px_1fr] sm:gap-6">
                  <span className="text-lg font-bold">{label}</span>
                  <input
                    value={newUser[key]}
                    onChange={(event) => setNewUser({ ...newUser, [key]: event.target.value })}
                    placeholder="Type here..."
                    className="border-b border-dacs-dark/40 py-1.5 italic outline-none focus:border-dacs-dark"
                  />
                </label>
              ))}
              <label className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[160px_1fr] sm:gap-6">
                <span className="text-lg font-bold">Role</span>
                <select
                  value={newUser.role}
                  onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
                  className={`w-56 rounded-md border border-dacs-dark/50 px-3 py-2 text-sm ${newUser.role ? "" : "italic text-dacs-muted"}`}
                >
                  <option value="" disabled>
                    Choose Here...
                  </option>
                  {[...new Set([...permissions.roles, FARMER_ROLE_LABEL])].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-6 grid grid-cols-1 items-center gap-2 sm:grid-cols-[160px_1fr] sm:gap-6">
                <span className="text-lg font-bold">Profile Photo</span>
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={newUser.avatar || "/dacs-logo.png"}
                    alt="Profile preview"
                    className="h-14 w-14 rounded-full border border-dacs-light object-cover"
                  />
                  <button
                    type="button"
                    disabled
                    title="Profile photos aren't stored by the backend yet."
                    className="flex items-center gap-2 rounded-xl border border-dacs-dark/25 px-4 py-2 text-sm font-medium text-dacs-muted opacity-60"
                  >
                    <Upload size={14} />
                    Upload (optional)
                  </button>
                  {!newUser.avatar && (
                    <span className="text-sm text-dacs-muted">
                      The DACS logo is used for now — photo upload arrives with backend photo storage.
                    </span>
                  )}
                  <input
                    ref={newUserPhotoInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        readImage(file, (avatar) => setNewUser({ ...newUser, avatar }));
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>

              <div className="mt-16 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void createUser()}
                  disabled={
                    savingUser ||
                    !newUser.firstName.trim() ||
                    !newUser.email.trim() ||
                    !newUser.role
                  }
                  className="rounded-2xl bg-dacs-dark px-8 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {savingUser ? "Creating…" : "Create User"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingUser(false)}
                  className="rounded-2xl border border-dacs-dark/40 px-8 py-3 font-semibold hover:bg-dacs-light/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ---------------------------------- Roles and Permission */}
          {tab === "Roles and Permission" && canManageRoles && (
            <div>
              <div className="mb-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAddingRole(true)}
                  className="flex items-center gap-1 rounded-2xl bg-dacs-dark px-7 py-3 font-semibold text-white hover:opacity-90"
                >
                  <Plus size={16} />
                  Add Role
                </button>
              </div>

              <TableShell>
                <thead>
                  <tr>
                    <Th>Module</Th>
                    {permissions.roles.map((role) => (
                      <Th key={role}>
                        <span className="flex items-center justify-center gap-2">
                          {role}
                          {/* Custom roles are deletable; system roles are not. */}
                          {!PROTECTED_ROLES.includes(role) && (
                            <button
                              type="button"
                              aria-label={`Delete role ${role}`}
                              title={`Delete role ${role}`}
                              onClick={() => requestRoleDelete(role)}
                              className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </span>
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.map((permissionModule) => (
                    <tr key={permissionModule}>
                      <Td className="text-left font-medium">{permissionModule}</Td>
                      {permissions.roles.map((role) => (
                        <Td key={role}>
                          <GrantMark
                            granted={!!permissions.grants[permissionModule]?.[role]}
                            onToggle={() => toggleGrant(permissionModule, role)}
                          />
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </TableShell>

              <div className="mt-8 flex items-center justify-end gap-4">
                {permissionsSaved && (
                  <span className="text-sm font-medium text-green-700">Saved ✓</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!canManageRoles) return;
                    appendAudit("Users", "PERMISSIONS_UPDATED", "Saved the role permission matrix.");
                    flash(setPermissionsSaved);
                  }}
                  className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
                >
                  Save Changes
                </button>
              </div>
              <p className="mt-3 text-right text-sm text-dacs-muted">
                Unchecking a module for a role locks that page behind the
                Access Denied screen for those users.
              </p>
            </div>
          )}

          {/* ------------------------------------- System Preferences */}
          {tab === "System Preferences" && (
            <div className="max-w-2xl">
              <h2 className="mb-2 text-xl font-bold">Date Format</h2>
              {(["MM/DD/YYYY", "DD/MM/YYYY"] as const).map((value) => (
                <OptionRow
                  key={value}
                  label={value}
                  selected={preferences.dateFormat === value}
                  onSelect={() => setPreferences({ ...preferences, dateFormat: value })}
                />
              ))}

              <h2 className="mb-2 mt-8 text-xl font-bold">Time Format</h2>
              {(["12-hour", "24-hour"] as const).map((value) => (
                <OptionRow
                  key={value}
                  label={value}
                  selected={preferences.timeFormat === value}
                  onSelect={() => setPreferences({ ...preferences, timeFormat: value })}
                />
              ))}

              <h2 className="mb-2 mt-8 text-xl font-bold">Default Landing Page</h2>
              {(["Dashboard", "Customer Information", "Orders"] as const).map((value) => (
                <OptionRow
                  key={value}
                  label={value}
                  selected={preferences.landingPage === value}
                  onSelect={() => setPreferences({ ...preferences, landingPage: value })}
                />
              ))}

              <div className="mt-8 flex items-center justify-end gap-4">
                {preferencesSaved && (
                  <span className="text-sm font-medium text-green-700">Saved ✓</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    appendAudit("Settings", "PREFERENCES_UPDATED", "Saved system preferences.");
                    flash(setPreferencesSaved);
                  }}
                  className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------ Notifications */}
          {tab === "Notifications" && (
            <div className="max-w-2xl">
              <button
                type="button"
                role="switch"
                aria-checked={notifPrefs.enabled}
                onClick={toggleNotifMaster}
                className="flex items-center gap-4"
              >
                <span
                  className={`flex h-8 w-14 items-center rounded-full p-1 transition-colors ${
                    notifPrefs.enabled ? "bg-green-500" : "bg-dacs-light"
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full bg-dacs-dark transition-transform ${
                      notifPrefs.enabled ? "translate-x-6" : ""
                    }`}
                  />
                </span>
                <span className="text-lg font-bold">
                  Notifications {notifPrefs.enabled ? "On" : "Off"}
                </span>
              </button>

              <div className={`mt-8 flex flex-col gap-4 ${notifPrefs.enabled ? "" : "pointer-events-none opacity-40"}`}>
                {NOTIFICATION_TYPES.map((type) => {
                  const serverBacked = Boolean(NOTIFICATION_ENUM_BY_LABEL[type]);
                  return (
                    <label
                      key={type}
                      title={
                        serverBacked
                          ? undefined
                          : "The system does not send this notification yet."
                      }
                      className={`flex items-center gap-4 ${
                        serverBacked ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-md border-2 ${
                          notifPrefs.types[type]
                            ? "border-dacs-red"
                            : "border-dacs-dark/30"
                        }`}
                      >
                        {notifPrefs.types[type] && (
                          <Check size={18} strokeWidth={3} className="text-dacs-red" />
                        )}
                      </span>
                      <input
                        type="checkbox"
                        checked={!!notifPrefs.types[type]}
                        disabled={!serverBacked}
                        onChange={() => toggleNotifType(type)}
                        className="sr-only"
                      />
                      <span className="text-lg">{type}</span>
                    </label>
                  );
                })}
              </div>

              <div className="mt-10 flex items-center justify-end gap-4">
                {notifSaved && (
                  <span className="text-sm font-medium text-green-700">Saved ✓</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    appendAudit("Settings", "NOTIFICATION_PREFS_UPDATED", "Saved notification preferences.");
                    flash(setNotifSaved);
                  }}
                  className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
                >
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* ---------------------------------------- Data Management */}
          {tab === "Data Management" && (
            <div className="max-w-2xl">
              {[
                ["Database Status", "Connected"],
                ["Total Records", "2,451"],
                ["Last Backup", "June 22, 2026"],
                ["Storage Used", "482 MB"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between border-b border-dacs-light py-5"
                >
                  <span className="text-xl font-bold">{label}</span>
                  <span className="text-lg">{value}</span>
                </div>
              ))}
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={exportDatabase}
                  className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
                >
                  Export Database
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------------- Audit Logs */}
          {tab === "Audit Logs" && (
            <div>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="relative max-w-md flex-1">
                  <input
                    value={logSearch}
                    onChange={(event) => setLogSearch(event.target.value)}
                    placeholder="Search User..."
                    className="w-full rounded-full border border-dacs-dark/40 py-2.5 pl-5 pr-11 text-sm italic outline-none focus:border-dacs-dark"
                  />
                  <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2" />
                </div>
                <FilterButton
                  rows={allLogs}
                  columns={LOG_COLUMNS}
                  query={logQuery}
                  onChange={setLogQuery}
                />
              </div>
              <TableShell>
                <thead>
                  <tr>
                    <Th>Timestamp</Th>
                    <Th>User</Th>
                    <Th>Module</Th>
                    <Th>Status</Th>
                    <Th>Description</Th>
                  </tr>
                </thead>
                <tbody>
                  {auditLoading && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={5}>
                        Loading audit logs…
                      </Td>
                    </tr>
                  )}
                  {!auditLoading && auditError && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={5}>
                        {auditError}
                      </Td>
                    </tr>
                  )}
                  {!auditLoading &&
                    !auditError &&
                    filteredLogs.map((log) => (
                      <tr key={log.id}>
                        <Td>
                          {new Date(log.createdAt).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                          })}
                        </Td>
                        <Td>{log.roleLabel}</Td>
                        <Td>{log.module}</Td>
                        <Td>
                          {log.action
                            .split("_")
                            .slice(-1)[0]
                            .toLowerCase()
                            .replace(/^./, (c) => c.toUpperCase())}
                        </Td>
                        <Td>{log.description}</Td>
                      </tr>
                    ))}
                  {!auditLoading && !auditError && filteredLogs.length === 0 && (
                    <tr>
                      <Td className="py-10 text-dacs-muted" colSpan={5}>
                        No audit entries match the current search/filter.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </TableShell>
            </div>
          )}

          {/* ------------------------------------------- About System */}
          {tab === "About System" && (
            <div className="max-w-2xl">
              {[
                ["System", "Digital Agriculture Collaboration and Support"],
                ["Domain", "https://dominantasia.com"],
                ["Login ID", "0001"],
                ["Email", userInfo.emailAddress],
                ["Version", "1.0.0"],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-dacs-light py-5">
                  <p className="text-xl font-bold">{label}</p>
                  <p className="mt-1 text-lg">{value}</p>
                </div>
              ))}

              <div className="mt-10 flex items-center justify-between text-sm">
                <div className="flex gap-6">
                  <a
                    href={TERMS_AND_CONDITIONS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-dacs-red"
                  >
                    Terms &amp; Conditions
                  </a>
                  <a
                    href={PRIVACY_POLICY_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4 hover:text-dacs-red"
                  >
                    Privacy Policy
                  </a>
                </div>
                <span className="text-dacs-muted">
                  © 2026 National Group Research. All rights reserved.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmations */}
      {pendingUserDelete && (
        <ConfirmDialog
          message="Delete User?"
          detail={`Are you sure you want to delete ${pendingUserDelete.name} (${pendingUserDelete.email})? The account will be disabled and can no longer sign in.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void deleteUser(pendingUserDelete)}
          onCancel={() => setPendingUserDelete(null)}
        />
      )}
      {pendingRoleDelete && canManageRoles && (
        <ConfirmDialog
          message="Delete Role?"
          detail={`Are you sure you want to delete the "${pendingRoleDelete}" role? This action cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => deleteRole(pendingRoleDelete)}
          onCancel={() => setPendingRoleDelete(null)}
        />
      )}

      {/* Add Role dialog */}
      {addingRole && canManageRoles && (
        <Modal onClose={() => setAddingRole(false)} width="max-w-[460px]">
          <h2 className="mb-5 text-2xl font-bold">Add Role</h2>
          <input
            value={newRoleName}
            onChange={(event) => setNewRoleName(event.target.value)}
            placeholder="Role name..."
            className="w-full rounded-lg border border-dacs-dark/40 px-4 py-2.5 outline-none focus:border-dacs-dark"
          />
          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={addRole}
              disabled={!newRoleName.trim()}
              className="rounded-2xl bg-dacs-dark px-7 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              Add Role
            </button>
            <button
              type="button"
              onClick={() => setAddingRole(false)}
              className="rounded-2xl border border-dacs-dark/40 px-7 py-2.5 font-semibold hover:bg-dacs-light/50"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
