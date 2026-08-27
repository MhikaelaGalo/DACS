/**
 * Permanently removes DACS accounts named on the command line — the
 * users row, the customer profile and everything hanging off it, the
 * on-disk files those records own, and the Firebase sign-in identity.
 *
 * This is the ONLY hard delete in the system. The admin UI's Delete
 * button is a soft delete by design (PATCH /api/users/:id/status →
 * DISABLED); there is deliberately no DELETE endpoint, so purging is a
 * deliberate, out-of-band act rather than a mis-clickable button.
 *
 * Deleting the Firebase identity is not optional. /api/auth/sync
 * re-creates a users row for any Firebase account that signs in without
 * one (auth.service.ts), so removing only the database row demotes the
 * account to CLIENT_FARMER instead of removing it.
 *
 * Refusals — the script skips the account rather than doing half a job:
 *   • Owner accounts, mirroring the UI's own protection.
 *   • Any profile holding HISTORICAL_IMPORT orders: those are migrated
 *     legacy records and must survive every cleanup.
 *
 * Runs against the backend .env DATABASE_URL (dev / Cloud SQL), not the
 * test database — this is a live-data tool.
 *
 *   npx tsx scripts/purge-account.ts <email> [more emails...]           (dry run)
 *   npx tsx scripts/purge-account.ts <email> [more emails...] --apply   (delete)
 */
import "dotenv/config";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";
import {
  deleteFileByUrl,
  deletePrivateFile,
} from "../src/services/fileStorage.service";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const emails = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

if (emails.length === 0) {
  console.error(
    "Usage: npx tsx scripts/purge-account.ts <email> [more emails...] [--apply]"
  );
  process.exit(1);
}

let purged = 0;
let refused = 0;

for (const email of emails) {
  console.log(`\n=== ${email} ===`);

  const user = await prisma.user.findUnique({
    where: { email },
    include: { customerProfile: true },
  });

  if (!user) {
    console.log("No users row for that email — skipped.");
    continue;
  }

  console.log(
    `users row ${user.id}  role=${user.role}  status=${user.status}  ` +
      `firebase=${user.firebaseUid ?? "(never signed in)"}`
  );

  if (user.role === "OWNER_EXECUTIVE") {
    console.log("REFUSED: Owner accounts are protected.");
    refused += 1;
    continue;
  }

  const profile = user.customerProfile;

  /*
   * Everything is collected before anything is deleted, so the dry run
   * prints exactly what --apply would remove.
   */
  const orders = profile
    ? await prisma.order.findMany({
        where: { customerProfileId: profile.id },
        select: { id: true, orderNumber: true, status: true, source: true },
      })
    : [];

  const historicalOrders = orders.filter(
    (o) => o.source === "HISTORICAL_IMPORT"
  );
  if (profile && historicalOrders.length > 0) {
    console.log(
      `REFUSED: profile ${profile.customerNumber} holds ` +
        `${historicalOrders.length} HISTORICAL_IMPORT order(s) — migrated ` +
        "legacy data is never deleted."
    );
    refused += 1;
    continue;
  }

  const [
    farms,
    payments,
    monitorings,
    enrollments,
    certRequests,
    tickets,
    submissions,
    historicalRecords,
  ] = profile
    ? await Promise.all([
        prisma.farm.findMany({
          where: { customerProfileId: profile.id },
          select: { id: true, farmName: true },
        }),
        prisma.payment.findMany({
          where: { customerProfileId: profile.id },
          select: {
            id: true,
            paymentType: true,
            status: true,
            proofStorageUrl: true,
          },
        }),
        prisma.breederMonitoring.findMany({
          where: { customerProfileId: profile.id },
          select: { id: true },
        }),
        prisma.seminarEnrollment.findMany({
          where: { customerProfileId: profile.id },
          select: {
            id: true,
            module: { select: { moduleNumber: true, title: true } },
          },
        }),
        prisma.certificateRequest.findMany({
          where: { customerProfileId: profile.id },
          select: {
            id: true,
            certificateNumber: true,
            status: true,
            certificateFilePath: true,
          },
        }),
        prisma.inquiryTicket.findMany({
          where: { customerProfileId: profile.id },
          select: { id: true, ticketNumber: true, status: true },
        }),
        prisma.formSubmission.findMany({
          where: { customerProfileId: profile.id },
          select: { id: true },
        }),
        prisma.historicalSourceRecord.count({
          where: { customerProfileId: profile.id },
        }),
      ])
    : [[], [], [], [], [], [], [], 0];

  const monitoringIds = monitorings.map((m) => m.id);
  const breederCerts = await prisma.breederCertification.findMany({
    where: { monitoringId: { in: monitoringIds } },
    select: { id: true, certificateNumber: true },
  });

  // Cascade or SetNull — reported for transparency, never deleted by hand.
  const [logs, notifications, preferences, visuals] = await Promise.all([
    prisma.activityLog.count({ where: { userId: user.id } }),
    prisma.notification.count({ where: { userId: user.id } }),
    prisma.notificationPreference.count({ where: { userId: user.id } }),
    prisma.dashboardVisual.count({ where: { userId: user.id } }),
  ]);

  if (profile) {
    console.log(
      `profile ${profile.customerNumber} ` +
        `(${profile.firstName} ${profile.lastName})`
    );
    for (const f of farms) console.log(`  farm ${f.farmName}`);
    for (const o of orders)
      console.log(`  order ${o.orderNumber} (${o.status})`);
    for (const p of payments)
      console.log(
        `  payment ${p.paymentType} ${p.status}` +
          (p.proofStorageUrl ? " + proof file" : "")
      );
    for (const c of breederCerts)
      console.log(`  breeder certification ${c.certificateNumber}`);
    for (const m of monitorings) console.log(`  breeder monitoring ${m.id}`);
    for (const e of enrollments)
      console.log(
        `  seminar enrollment: Module ${e.module.moduleNumber} — ` +
          `${e.module.title}`
      );
    for (const c of certRequests)
      console.log(
        `  seminar certificate ${c.certificateNumber ?? "(no number)"} ` +
          `(${c.status})`
      );
    for (const t of tickets)
      console.log(`  ticket ${t.ticketNumber} (${t.status})`);
    for (const s of submissions) console.log(`  form submission ${s.id}`);
  } else {
    // Staff never have one; a farmer without one has simply never
    // completed registration, so there is nothing but the row to remove.
    console.log("profile: none — no customer data attached");
  }

  console.log(
    `  cascades away: ${notifications} notification(s), ` +
      `${preferences} preference(s), ${visuals} dashboard visual(s)`
  );
  console.log(
    `  survives, attribution blanked: ${logs} activity log(s)` +
      (historicalRecords > 0
        ? `, ${historicalRecords} historical source record(s)`
        : "")
  );

  if (!apply) {
    console.log("  DRY RUN — nothing deleted. Re-run with --apply.");
    continue;
  }

  const deletedIds = [
    ...orders.map((o) => o.id),
    ...payments.map((p) => p.id),
    ...monitoringIds,
    ...breederCerts.map((c) => c.id),
    ...enrollments.map((e) => e.id),
    ...certRequests.map((c) => c.id),
    ...tickets.map((t) => t.id),
    ...farms.map((f) => f.id),
    ...(profile ? [profile.id] : []),
  ];

  await prisma.$transaction(async (tx) => {
    /*
     * Children first, respecting every Restrict FK. Cascades cover
     * order items, order/payment/ticket status history, breeder
     * eligibility, and seminar watch progress + quiz attempts.
     * Monitorings must precede farms — they Restrict on farm too.
     */
    if (profile) {
      await tx.breederCertification.deleteMany({
        where: { monitoringId: { in: monitoringIds } },
      });
      await tx.breederMonitoring.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.payment.deleteMany({ where: { customerProfileId: profile.id } });
      await tx.order.deleteMany({ where: { customerProfileId: profile.id } });
      await tx.seminarEnrollment.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.certificateRequest.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.inquiryTicket.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.formSubmission.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.farm.deleteMany({ where: { customerProfileId: profile.id } });

      // Staff notifications pointing at records that no longer exist.
      await tx.notification.deleteMany({
        where: { recordId: { in: deletedIds } },
      });

      await tx.customerProfile.delete({ where: { id: profile.id } });
    }

    /*
     * The users row is about to go and activity_logs.user_id is
     * SetNull — the history survives but stops naming anyone. Leave a
     * standalone entry so the purge itself is on the record.
     */
    await tx.activityLog.create({
      data: {
        userId: null,
        module: "USERS",
        action: "ACCOUNT_PURGED",
        outcome: "SUCCESS",
        description:
          `Account ${email} (${user.role}) was permanently deleted by ` +
          "scripts/purge-account.ts.",
        recordType: "User",
        recordId: user.id,
      },
    });

    await tx.user.delete({ where: { id: user.id } });
  });

  // Files live on disk, not in PostgreSQL — best-effort unlink once the
  // rows referencing them are gone.
  for (const p of payments)
    if (p.proofStorageUrl) await deleteFileByUrl(p.proofStorageUrl);
  for (const c of certRequests)
    if (c.certificateFilePath) await deletePrivateFile(c.certificateFilePath);

  console.log("  DELETED database records.");

  if (!user.firebaseUid) {
    console.log("  No Firebase identity to remove (never signed in).");
  } else if (!firebaseAuth) {
    console.log(
      `  ACTION REQUIRED: Firebase Admin is not configured, so uid ` +
        `${user.firebaseUid} still exists. Delete it in the Firebase ` +
        "console — otherwise signing in re-creates this account as a farmer."
    );
  } else {
    try {
      await firebaseAuth.deleteUser(user.firebaseUid);
      console.log(`  Deleted Firebase user ${user.firebaseUid}.`);
    } catch (error) {
      console.log(
        `  ACTION REQUIRED: could not delete Firebase user ` +
          `${user.firebaseUid} (${(error as Error).message}). Remove it in ` +
          "the Firebase console — otherwise signing in re-creates this " +
          "account as a farmer."
      );
    }
  }

  purged += 1;
}

console.log(
  apply
    ? `\nDone — ${purged} account(s) purged` +
        (refused > 0 ? `, ${refused} refused.` : ".")
    : `\nDry run only — no changes made` +
        (refused > 0 ? ` (${refused} refused).` : ".")
);

await prisma.$disconnect();
