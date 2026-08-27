/**
 * One-off content fix: rename the three launch seminar modules to the
 * official names from the reference design. The module title lives in
 * seminar_modules.title (the single source of truth read by both the
 * customer site and the admin portal), so this renames the rows in
 * place — same ids, same module numbers, same publish state, and no
 * effect on enrollments, progress, quiz attempts or certificates,
 * which all reference modules by id.
 *
 * Run:
 *   npx tsx scripts/rename-seminar-modules.ts           (dry run)
 *   npx tsx scripts/rename-seminar-modules.ts --apply
 */
import "dotenv/config";

import { prisma } from "../src/config/database";

const OFFICIAL_TITLES: Record<number, string> = {
  1: "Module 1: A Clearer Perspective of the Free-Range Poultry Scenario in the Philippines",
  2: "Module 2: AgriEntrepreneurship Online Seminar",
  3: "Module 3: Dominant Cz Genetics & Breeding Seminar",
};

function describeDatabase(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return `${url.hostname}:${url.port}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  console.log(`Database: ${describeDatabase()}`);
  console.log(apply ? "Mode: APPLY\n" : "Mode: dry run (pass --apply to write)\n");

  const moduleNumbers = Object.keys(OFFICIAL_TITLES).map(Number);
  const modules = await prisma.seminarModule.findMany({
    where: { moduleNumber: { in: moduleNumbers } },
    orderBy: { moduleNumber: "asc" },
  });

  const missing = moduleNumbers.filter(
    (n) => !modules.some((m) => m.moduleNumber === n)
  );
  if (missing.length > 0) {
    // Renaming only — a missing module is never created here.
    console.error(
      `Missing module number(s) ${missing.join(", ")} in this database. ` +
        "Nothing was changed."
    );
    process.exitCode = 1;
    return;
  }

  for (const module of modules) {
    const target = OFFICIAL_TITLES[module.moduleNumber];
    console.log(`Module ${module.moduleNumber} (id ${module.id})`);
    console.log(`  current: ${module.title}`);
    if (module.title === target) {
      console.log("  already the official title — skipped.\n");
      continue;
    }
    console.log(`  new:     ${target}`);
    if (apply) {
      await prisma.seminarModule.update({
        where: { id: module.id },
        data: { title: target },
      });
      console.log("  renamed.\n");
    } else {
      console.log("  (dry run — not written)\n");
    }
  }

  if (apply) {
    const after = await prisma.seminarModule.findMany({
      where: { moduleNumber: { in: moduleNumbers } },
      orderBy: { moduleNumber: "asc" },
    });
    console.log("Titles now in the database:");
    for (const module of after) {
      console.log(
        `  ${module.moduleNumber}. ${module.title} ` +
          `(published=${module.isPublished})`
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
