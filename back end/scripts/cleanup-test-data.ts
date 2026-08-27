/**
 * Development helper: purges the TEST RECORDS a customer account created
 * while testing — LIVE orders (items, status history, payments and their
 * proof files), the breeder chain hanging off those orders, seminar
 * enrollments (watch progress + quiz attempts), seminar certificate
 * requests, inquiry tickets, and the staff notifications that point at
 * the deleted records.
 *
 * The account itself is KEPT (users row, customer profile, farms), so
 * the same login can keep testing afterwards.
 *
 * Runs against the backend .env DATABASE_URL (the dev database). It can
 * NEVER touch migrated legacy data: orders and payments are filtered to
 * source = LIVE, and historical_source_records / spreadsheet imports are
 * never queried at all.
 *
 *   npx tsx scripts/cleanup-test-data.ts <email> [more emails...]           (dry run)
 *   npx tsx scripts/cleanup-test-data.ts <email> [more emails...] --apply   (delete)
 */
import "dotenv/config";

import { prisma } from "../src/config/database";
import { deleteFileByUrl } from "../src/services/fileStorage.service";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const emails = args
  .filter((a) => !a.startsWith("--"))
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

if (emails.length === 0) {
  console.error(
    "Usage: npx tsx scripts/cleanup-test-data.ts <email> [more emails...] [--apply]"
  );
  process.exit(1);
}

async function profilesForEmail(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { customerProfile: true },
  });
  if (user?.customerProfile) return [user.customerProfile];

  // Historical/unclaimed profiles have no users row; match contact email.
  return prisma.customerProfile.findMany({
    where: { contactEmail: { equals: email, mode: "insensitive" } },
  });
}

let grandTotal = 0;

for (const email of emails) {
  console.log(`\n=== ${email} ===`);

  const profiles = await profilesForEmail(email);
  if (profiles.length === 0) {
    console.log("No account or customer profile found — skipped.");
    continue;
  }

  for (const profile of profiles) {
    console.log(
      `Profile ${profile.customerNumber} (${profile.firstName} ${profile.lastName})`
    );

    // Only LIVE orders — HISTORICAL_IMPORT rows are migrated legacy data
    // and must survive every cleanup.
    const orders = await prisma.order.findMany({
      where: { customerProfileId: profile.id, source: "LIVE" },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const orderIds = orders.map((o) => o.id);

    const payments = await prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true, paymentType: true, status: true, proofStorageUrl: true },
    });

    const monitorings = await prisma.breederMonitoring.findMany({
      where: { parentStockOrderId: { in: orderIds } },
      select: { id: true, releasedAt: true },
    });
    const monitoringIds = monitorings.map((m) => m.id);

    const breederCerts = await prisma.breederCertification.findMany({
      where: { monitoringId: { in: monitoringIds } },
      select: { id: true, certificateNumber: true, status: true },
    });

    const enrollments = await prisma.seminarEnrollment.findMany({
      where: { customerProfileId: profile.id },
      select: { id: true, module: { select: { moduleNumber: true, title: true } } },
    });

    const certRequests = await prisma.certificateRequest.findMany({
      where: { customerProfileId: profile.id },
      select: { id: true, status: true, certificateNumber: true },
    });

    const tickets = await prisma.inquiryTicket.findMany({
      where: { customerProfileId: profile.id },
      select: { id: true, ticketNumber: true, subject: true, status: true },
    });

    // Breeder records on NON-LIVE orders are only reported, never deleted:
    // if one exists, staff created it against a migrated legacy order.
    const monitoringsOnHistorical = await prisma.breederMonitoring.count({
      where: {
        customerProfileId: profile.id,
        parentStockOrder: { source: "HISTORICAL_IMPORT" },
      },
    });

    for (const o of orders)
      console.log(
        `  order ${o.orderNumber}  ${o.status}  total ${o.totalAmount}  (${o.createdAt.toISOString().slice(0, 10)})`
      );
    for (const p of payments)
      console.log(`  payment ${p.paymentType} ${p.status}${p.proofStorageUrl ? " + proof file" : ""}`);
    for (const c of breederCerts)
      console.log(`  breeder certification ${c.certificateNumber} (${c.status})`);
    for (const m of monitorings)
      console.log(`  breeder monitoring released ${m.releasedAt.toISOString().slice(0, 10)}`);
    for (const e of enrollments)
      console.log(`  seminar enrollment: Module ${e.module.moduleNumber} — ${e.module.title}`);
    for (const c of certRequests)
      console.log(`  seminar certificate request ${c.certificateNumber ?? "(no number)"} (${c.status})`);
    for (const t of tickets)
      console.log(`  ticket ${t.ticketNumber}  ${t.status}  "${t.subject}"`);

    const total =
      orders.length +
      payments.length +
      breederCerts.length +
      monitorings.length +
      enrollments.length +
      certRequests.length +
      tickets.length;
    grandTotal += total;

    if (monitoringsOnHistorical > 0)
      console.log(
        `  NOTE: ${monitoringsOnHistorical} breeder monitoring record(s) sit on HISTORICAL orders — left untouched, review manually.`
      );

    if (total === 0) {
      console.log("  Nothing to delete.");
      continue;
    }

    if (!apply) {
      console.log(`  DRY RUN — ${total} record(s) would be deleted.`);
      continue;
    }

    const deletedIds = [
      ...orderIds,
      ...payments.map((p) => p.id),
      ...monitoringIds,
      ...breederCerts.map((c) => c.id),
      ...enrollments.map((e) => e.id),
      ...certRequests.map((c) => c.id),
      ...tickets.map((t) => t.id),
    ];

    await prisma.$transaction(async (tx) => {
      // Children first, respecting every Restrict FK. Cascades cover
      // order_items, order/payment/ticket status history, breeder
      // eligibility, seminar progress and quiz attempts.
      await tx.breederCertification.deleteMany({
        where: { id: { in: breederCerts.map((c) => c.id) } },
      });
      await tx.breederMonitoring.deleteMany({
        where: { id: { in: monitoringIds } },
      });
      await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      await tx.seminarEnrollment.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.certificateRequest.deleteMany({
        where: { customerProfileId: profile.id },
      });
      await tx.inquiryTicket.deleteMany({
        where: { customerProfileId: profile.id },
      });
      // Staff notifications that link to now-deleted records (the
      // NEW_CUSTOMER one points at the profile, which stays).
      await tx.notification.deleteMany({
        where: { recordId: { in: deletedIds } },
      });
    });

    // Proof images live on disk, not in PostgreSQL — best-effort unlink
    // after the rows are gone.
    for (const p of payments)
      if (p.proofStorageUrl) await deleteFileByUrl(p.proofStorageUrl);

    console.log(`  DELETED ${total} record(s).`);
  }
}

console.log(
  apply
    ? `\nDone — ${grandTotal} record(s) deleted.`
    : `\nDry run only — ${grandTotal} record(s) would be deleted. Re-run with --apply to delete.`
);

await prisma.$disconnect();
