import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is missing. Check the backend .env file."
  );
}

/*
 * Test-mode safety guard. Automated tests (scripts/lib/test-env.ts) and
 * the test server (npm run dev:test, which loads .env.test) both set
 * DACS_TEST_MODE=1. In that mode this process may only ever attach to a
 * dedicated test database — never to the development database — so a
 * misconfigured .env.test fails loudly here instead of letting test
 * fixtures contaminate real data.
 */
if (process.env.DACS_TEST_MODE === "1") {
  let databaseName = "";
  try {
    databaseName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    // fall through to the refusal below with an empty name
  }

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `DACS_TEST_MODE=1 but DATABASE_URL points at "${databaseName}". ` +
        "Refusing to start against a non-test database. Fix .env.test " +
        '(the database name must contain "test", e.g. dacs_test_db).'
    );
  }
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

export { prisma };
