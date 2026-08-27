/*
 * Browser-verification helper (temporary): flips the synthetic farmer
 * fixture's Module 2/3 completion for UI demos of the purchase states.
 *
 *   npx tsx scripts/tmp-toggle-fixture-completion.ts uncomplete
 *   npx tsx scripts/tmp-toggle-fixture-completion.ts restore
 *
 * Only enrollment.completedAt is touched (progress/quiz rows stay);
 * "restore" re-stamps the exact timestamps saved by "uncomplete" in
 * scripts/tmp-fixture-completion-backup.json.
 */
import "dotenv/config";

import { readFileSync, writeFileSync } from "node:fs";

import { prisma } from "../src/config/database";

const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";
const BACKUP_FILE = "scripts/tmp-fixture-completion-backup.json";

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== "uncomplete" && mode !== "restore") {
    throw new Error("Usage: tmp-toggle-fixture-completion.ts uncomplete|restore");
  }

  const user = await prisma.user.findUnique({
    where: { email: FARMER_EMAIL },
    select: { id: true },
  });
  if (!user) throw new Error("Fixture farmer not found.");
  const profile = await prisma.customerProfile.findFirst({
    where: { userId: user.id, archivedAt: null },
    select: { id: true },
  });
  if (!profile) throw new Error("Fixture profile not found.");

  if (mode === "uncomplete") {
    const enrollments = await prisma.seminarEnrollment.findMany({
      where: {
        customerProfileId: profile.id,
        module: { moduleNumber: { in: [2, 3] } },
      },
      select: { id: true, completedAt: true, module: { select: { moduleNumber: true } } },
    });
    writeFileSync(
      BACKUP_FILE,
      JSON.stringify(
        enrollments.map((entry) => ({
          id: entry.id,
          moduleNumber: entry.module.moduleNumber,
          completedAt: entry.completedAt,
        })),
        null,
        2
      )
    );
    for (const enrollment of enrollments) {
      await prisma.seminarEnrollment.update({
        where: { id: enrollment.id },
        data: { completedAt: null },
      });
    }
    console.log(`Uncompleted ${enrollments.length} enrollments (backup saved).`);
  } else {
    const backup = JSON.parse(readFileSync(BACKUP_FILE, "utf8")) as Array<{
      id: string;
      completedAt: string | null;
    }>;
    for (const entry of backup) {
      await prisma.seminarEnrollment.update({
        where: { id: entry.id },
        data: { completedAt: entry.completedAt ? new Date(entry.completedAt) : null },
      });
    }
    console.log(`Restored ${backup.length} enrollments.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
