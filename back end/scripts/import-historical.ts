/**
 * Imports a Dominant Asia historical spreadsheet into PostgreSQL using
 * the same pipeline as POST /api/historical/files.
 *
 *   npx tsx scripts/import-historical.ts "C:/path/to/file.xlsx" [category] [year]
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "../src/config/database";
import { importHistoricalWorkbook } from "../src/modules/historical/historical.service";

const filePath = process.argv[2];
const category = process.argv[3] ?? null;
const year = process.argv[4] ? Number(process.argv[4]) : null;

if (!filePath) {
  console.error(
    'Usage: npx tsx scripts/import-historical.ts "<file.xlsx>" [category] [year]'
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const buffer = readFileSync(filePath);
  const originalName = path.basename(filePath);

  console.log(`Importing "${originalName}" (${(buffer.length / 1024).toFixed(1)} KB)...\n`);

  const result = await importHistoricalWorkbook(
    null,
    buffer,
    originalName,
    { category, year, description: "Imported via CLI migration script." },
    {}
  );

  console.log(`Stored file: ${result.file.storageUrl}\n`);

  let totalCustomers = 0;
  let totalFarms = 0;
  let totalDuplicates = 0;
  let totalErrors = 0;

  for (const sheet of result.imports) {
    if (sheet.skipped) {
      console.log(`Sheet "${sheet.sheetName}": SKIPPED — ${sheet.skipped}`);
      continue;
    }

    console.log(
      `Sheet "${sheet.sheetName}": ${sheet.rowsProcessed} rows -> ` +
        `${sheet.customersCreated} customers, ${sheet.farmsCreated} farms, ` +
        `${sheet.duplicateRows} duplicates, ${sheet.errorRows} errors`
    );

    totalCustomers += sheet.customersCreated;
    totalFarms += sheet.farmsCreated;
    totalDuplicates += sheet.duplicateRows;
    totalErrors += sheet.errorRows;
  }

  console.log(
    `\nTOTAL: ${totalCustomers} customers imported, ${totalFarms} farms created, ` +
      `${totalDuplicates} duplicate rows, ${totalErrors} rows sent to import_errors.`
  );
}

main()
  .catch((error) => {
    console.error("Import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
