/**
 * Backfills the lossless historical layer (historical_source_records)
 * for workbooks that were imported BEFORE the layer existed, by
 * re-running every stored file through the current import pipeline.
 *
 *   npx tsx scripts/backfill-historical-records.ts
 *
 * Safe + idempotent by construction:
 *   - existing customers are matched by email — no new DAPG numbers
 *   - existing farms are matched by name — no duplicates
 *   - rows whose content is already captured count as duplicates
 * Running it twice therefore changes nothing the second time.
 */
import "dotenv/config";

import { prisma } from "../src/config/database";
import { reimportHistoricalFile } from "../src/modules/historical/historical.service";

async function main(): Promise<void> {
  const files = await prisma.historicalFile.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true },
  });

  if (files.length === 0) {
    console.log("No historical files found — nothing to backfill.");
    return;
  }

  const before = {
    profiles: await prisma.customerProfile.count(),
    farms: await prisma.farm.count(),
    records: await prisma.historicalSourceRecord.count(),
  };
  const maxDapgBefore = await prisma.customerProfile.findFirst({
    where: { customerNumber: { startsWith: "DAPG-" } },
    orderBy: { customerNumber: "desc" },
    select: { customerNumber: true },
  });

  console.log(
    `Backfilling ${files.length} historical file(s). Before: ` +
      `${before.profiles} profiles, ${before.farms} farms, ` +
      `${before.records} source records, max ${maxDapgBefore?.customerNumber ?? "none"}.\n`
  );

  for (const file of files) {
    console.log(`== ${file.originalName} (${file.id})`);
    try {
      const result = await reimportHistoricalFile(null, file.id, {});
      for (const sheet of result.imports) {
        if (sheet.skipped) {
          console.log(`   Sheet "${sheet.sheetName}": SKIPPED — ${sheet.skipped}`);
          continue;
        }
        console.log(
          `   Sheet "${sheet.sheetName}": ${sheet.rowsProcessed} rows -> ` +
            `${sheet.sourceRecordsCreated} records (${sheet.recordsFlagged} flagged), ` +
            `${sheet.customersCreated} customers, ${sheet.farmsCreated} farms, ` +
            `${sheet.duplicateRows} duplicates, ${sheet.errorRows} errors`
        );
      }
    } catch (error) {
      console.error(
        `   FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    }
  }

  const after = {
    profiles: await prisma.customerProfile.count(),
    farms: await prisma.farm.count(),
    records: await prisma.historicalSourceRecord.count(),
    flagged: await prisma.historicalSourceRecord.count({
      where: { validationStatus: { not: "VALID" } },
    }),
    linked: await prisma.historicalSourceRecord.count({
      where: { customerProfileId: { not: null } },
    }),
  };
  const maxDapgAfter = await prisma.customerProfile.findFirst({
    where: { customerNumber: { startsWith: "DAPG-" } },
    orderBy: { customerNumber: "desc" },
    select: { customerNumber: true },
  });

  console.log(
    `\nAfter: ${after.profiles} profiles (${after.profiles - before.profiles} new), ` +
      `${after.farms} farms (${after.farms - before.farms} new), ` +
      `${after.records} source records (${after.records - before.records} new, ` +
      `${after.linked} linked to customers, ${after.flagged} flagged for review), ` +
      `max ${maxDapgAfter?.customerNumber ?? "none"}.`
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
