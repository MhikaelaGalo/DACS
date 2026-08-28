"use client";

import { useState } from "react";
import { UserLock } from "lucide-react";

import { ROLE_BY_LABEL, type StaffRole } from "@/lib/auth";

/*
 * Figma role gate: Staff cannot open Forms or Historical Data. "Switch
 * Role" opens the Security Check card ("Please identify your role to
 * continue.") with the Owner / Administrative Staff / Staff dropdown.
 * With real accounts the Security Check simply re-identifies the
 * signed-in user; in the mock it sets the session role.
 */
export function AccessDenied({
  pageName,
  onRoleSelected,
}: {
  pageName: string;
  onRoleSelected: (role: StaffRole) => void;
}) {
  const [checking, setChecking] = useState(false);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-32 text-center">
      {checking ? (
        <div className="flex w-full max-w-[520px] flex-col items-center gap-3 rounded-dacs-card bg-white px-6 py-14 shadow-dacs-card sm:px-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <UserLock size={26} className="text-dacs-red" />
          </span>
          <p className="text-lg font-bold">Security Check</p>
          <p className="text-sm">Please identify your role to continue.</p>
          <p className="mt-2 text-sm text-dacs-muted">Select Your Role</p>
          <select
            defaultValue=""
            onChange={(event) => {
              const role = ROLE_BY_LABEL[event.target.value];
              if (role) onRoleSelected(role);
            }}
            className="w-[240px] rounded-md border border-dacs-dark/50 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose Here...
            </option>
            {Object.keys(ROLE_BY_LABEL).map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <h2 className="text-3xl font-bold text-dacs-red">Access Denied</h2>
          <p className="max-w-md text-dacs-dark">
            Staff members do not have permission to access {pageName}.
            <br />
            Please contact your Owner or Admin for access.
          </p>
          <button
            type="button"
            onClick={() => setChecking(true)}
            className="rounded-2xl bg-dacs-dark px-10 py-3.5 font-semibold text-white hover:opacity-90"
          >
            Switch Role
          </button>
        </>
      )}
    </div>
  );
}
