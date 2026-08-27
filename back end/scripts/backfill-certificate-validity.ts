/**
 * One-off data fix: give already-generated seminar certificates the
 * stored 2-year validity window the automatic workflow now writes at
 * creation time.
 *
 * Until this change, DACS auto-approved the Certificate of Attendance
 * when Modules 1-3 were completed (setting certificate_issued_at) but
 * left issued_at / valid_until null, because those two columns were
 * filled only by the retired staff "Issue Certificate" action. The
 * admin Seminar Progress table therefore showed "N/A / Not Issued" for
 * certificates that genuinely existed.
 *
 * This backfills exactly that gap, using the certificate's own issue
 * date as the source of truth:
 *
 *   issued_at  = certificate_issued_at
 *   valid_until = certificate_issued_at + CERTIFICATE_VALIDITY_YEARS
 *
 * Scope and safety:
 *   - Only APPROVED rows that HAVE certificate_issued_at and are
 *     MISSING issued_at or valid_until are touched.
 *   - Nothing is deleted or overwritten: already-issued certificates
 *     keep their original issued_at/valid_until untouched, and stored
 *     certificate files, numbers and review history are never modified.
 *   - Historical imports do not create certificate_requests rows at
 *     all, so imported seminar attendance is out of scope by design.
 *   - Idempotent: a second run reports zero rows to fix.
 *
 * Run:
 *   npx tsx scripts/backfill-certificate-validity.ts           (dry run)
 *   npx tsx scripts/backfill-certificate-validity.ts --apply
 */
import "dotenv/config";

import { prisma } from "../src/config/database";
import { certificateValidUntil } from "../src/modules/seminars/seminar.service";

const APPLY = process.argv.includes("--apply");

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const candidates = await prisma.certificateRequest.findMany({
    where: {
      status: "APPROVED",
      certificateIssuedAt: { not: null },
      OR: [{ issuedAt: null }, { validUntil: null }],
    },
    select: {
      id: true,
      certificateNumber: true,
      certificateIssuedAt: true,
      issuedAt: true,
      validUntil: true,
      customerProfile: { select: { customerNumber: true } },
    },
    orderBy: { certificateIssuedAt: "asc" },
  });

  console.log(
    `${candidates.length} certificate(s) missing a stored validity window.`
  );

  for (const row of candidates) {
    // Non-null by the query filter; narrowed here for the type checker.
    const issuedAt = row.certificateIssuedAt as Date;
    const validUntil = certificateValidUntil(issuedAt);

    console.log(
      `  ${row.certificateNumber ?? row.id} (${row.customerProfile.customerNumber}): ` +
        `issued ${isoDay(issuedAt)} -> valid until ${isoDay(validUntil)}`
    );

    if (!APPLY) continue;

    await prisma.certificateRequest.update({
      where: { id: row.id },
      data: {
        // issuedByUserId stays null: DACS issued this automatically.
        issuedAt: row.issuedAt ?? issuedAt,
        validUntil: row.validUntil ?? validUntil,
      },
    });
  }

  console.log(
    APPLY
      ? `Applied to ${candidates.length} certificate(s).`
      : "Dry run — re-run with --apply to write these values."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
