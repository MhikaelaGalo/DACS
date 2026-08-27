/**
 * Sets the official DACS seminar module prices (idempotent):
 *
 *   Module 1  — FREE (0)
 *   Module 2  — ₱2,700
 *   Module 3  — ₱2,600
 *
 * Prices live on seminar_modules.price (Decimal(12,2)) — the same money
 * representation as products/orders. Existing purchased orders keep
 * their own checkout-time snapshots, so re-running this never affects
 * anyone's paid access.
 *
 * Runs against the environment's DATABASE_URL (.env — the development
 * database). Run: npx tsx scripts/set-seminar-prices.ts
 */
import "dotenv/config";

import { Prisma } from "../generated/prisma/client";
import { prisma } from "../src/config/database";

const OFFICIAL_PRICES: Record<number, string> = {
  1: "0",
  2: "2700",
  3: "2600",
};

async function main(): Promise<void> {
  for (const [moduleNumber, price] of Object.entries(OFFICIAL_PRICES)) {
    const module = await prisma.seminarModule.findUnique({
      where: { moduleNumber: Number(moduleNumber) },
      select: { id: true, title: true, price: true },
    });

    if (!module) {
      console.log(`Module ${moduleNumber}: not found — skipped.`);
      continue;
    }

    if (module.price.equals(new Prisma.Decimal(price))) {
      console.log(
        `Module ${moduleNumber}: already ₱${price} — ${module.title}`
      );
      continue;
    }

    await prisma.seminarModule.update({
      where: { id: module.id },
      data: { price: new Prisma.Decimal(price) },
    });

    console.log(
      `Module ${moduleNumber}: ₱${module.price} -> ₱${price} — ${module.title}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
