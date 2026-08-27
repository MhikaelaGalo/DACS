/**
 * Grant (or change) a DACS staff role for any Google email — the code
 * path for making a personal Gmail an admin without the Firebase
 * console. Writes the users row that the backend treats as the only
 * authority on admin access (users.role).
 *
 * How access then works: if the row has no firebaseUid yet, the person
 * simply signs in on the admin portal with that Google account and the
 * pre-authorization path in src/modules/auth/auth.service.ts claims the
 * row on the first verified sign-in. If the email already has a linked
 * account (e.g. it was used as a farmer on the customer site), the role
 * change takes effect on their next portal sign-in.
 *
 * Run:
 *   npx tsx scripts/set-admin-email.ts you@gmail.com OWNER_EXECUTIVE
 *   npx tsx scripts/set-admin-email.ts you@gmail.com --show   (read-only check)
 *
 * Roles: OWNER_EXECUTIVE | ADMINISTRATIVE_STAFF | IT_STAFF | CLIENT_FARMER
 * (CLIENT_FARMER demotes — use it to revoke admin access.)
 */
import "dotenv/config";

import { prisma } from "../src/config/database";

import type { UserRole } from "../generated/prisma/client";

const ROLES: UserRole[] = [
  "OWNER_EXECUTIVE",
  "ADMINISTRATIVE_STAFF",
  "IT_STAFF",
  "CLIENT_FARMER",
];

function describeDatabase(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function printUser(label: string, user: {
  email: string;
  role: UserRole;
  status: string;
  firebaseUid: string | null;
  displayName: string | null;
  lastLoginAt: Date | null;
} | null): void {
  if (!user) {
    console.log(`${label}: no users row exists for this email.`);
    return;
  }
  console.log(
    `${label}: ${user.email} | role=${user.role} | status=${user.status} | ` +
      `displayName=${user.displayName ?? "(none)"} | ` +
      `firebaseUid=${user.firebaseUid ?? "(not linked yet)"} | ` +
      `lastLoginAt=${user.lastLoginAt?.toISOString() ?? "(never)"}`
  );
}

async function printStaffRoster(): Promise<void> {
  const staff = await prisma.user.findMany({
    where: { role: { not: "CLIENT_FARMER" } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });
  console.log(`\nStaff roster in this database (${staff.length}):`);
  for (const member of staff) {
    printUser("  -", member);
  }
  if (!staff.some((member) => member.role === "OWNER_EXECUTIVE" && member.status === "ACTIVE")) {
    console.warn(
      "\nWARNING: no ACTIVE OWNER_EXECUTIVE remains. Re-run this script to restore one."
    );
  }
}

async function main(): Promise<void> {
  const email = process.argv[2]?.toLowerCase();
  const roleArgument = process.argv[3];

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error(
      "Usage: npx tsx scripts/set-admin-email.ts <email> <role|--show>\n" +
        `Roles: ${ROLES.join(" | ")}`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Database: ${describeDatabase()}`);

  const existing = await prisma.user.findUnique({ where: { email } });
  printUser("Before", existing);

  if (!roleArgument || roleArgument === "--show") {
    return;
  }

  if (!ROLES.includes(roleArgument as UserRole)) {
    console.error(`Unknown role "${roleArgument}". Roles: ${ROLES.join(" | ")}`);
    process.exitCode = 1;
    return;
  }
  const role = roleArgument as UserRole;

  // status is reset to ACTIVE so granting a role also revives a row
  // that was previously suspended/disabled through User Management.
  const user = await prisma.user.upsert({
    where: { email },
    update: { role, status: "ACTIVE" },
    create: { email, role, status: "ACTIVE" },
  });
  printUser("After", user);

  if (!user.firebaseUid) {
    console.log(
      "\nNext step: sign in on the admin portal with this Google account. " +
        "The first verified sign-in links it to this row (ACCOUNT_LINKED)."
    );
  } else {
    console.log(
      "\nThis email already has a linked sign-in; the new role applies on the next request."
    );
  }

  await printStaffRoster();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
