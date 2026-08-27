/*
 * Shared bootstrap for every DACS automated test suite and fixture
 * script. Import this module FIRST — before anything that touches
 * ../src/config/database — so the test environment is in place when the
 * shared Prisma client constructs.
 *
 * What it does:
 *   1. Loads back end/.env.test (override: true) and refuses to run if
 *      the file is missing. Test configuration lives there, never in
 *      source code.
 *   2. Refuses to run unless DATABASE_URL points at a dedicated test
 *      database (name must contain "test", and must not be the dev
 *      database). Suites can therefore never mutate dacs_db, no matter
 *      what the shell environment holds.
 *   3. Defaults TEST_BASE_URL to the test server's port from .env.test.
 *   4. Exposes assertTestServer(): suites mutate data mostly THROUGH
 *      the API, so the server under test must itself be attached to the
 *      same test database. The handshake compares the database name the
 *      server reports (GET /api/health/database) with ours and aborts
 *      on any mismatch — this is what stops a suite from ever driving
 *      the dev server on :5000 again.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

export const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

const ENV_TEST_PATH = path.join(BACKEND_ROOT, ".env.test");

const loaded = dotenv.config({ path: ENV_TEST_PATH, override: true });
if (loaded.error) {
  throw new Error(
    `Automated tests require ${ENV_TEST_PATH}.\n` +
      "Copy .env.test.example to .env.test, point DATABASE_URL at the " +
      "dedicated test database (see scripts/setup-test-db.ts), and retry. " +
      "Tests never run against the development .env configuration."
  );
}

export function databaseNameOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

const databaseUrl = process.env.DATABASE_URL ?? "";
export const TEST_DATABASE_NAME = databaseNameOf(databaseUrl);

// The development database, by name. Belt-and-braces alongside the
// "must contain test" rule below.
const DEV_DATABASE_NAME = "dacs_db";

if (!TEST_DATABASE_NAME) {
  throw new Error(
    `.env.test has no parseable DATABASE_URL — refusing to run tests.`
  );
}

if (
  TEST_DATABASE_NAME === DEV_DATABASE_NAME ||
  !/test/i.test(TEST_DATABASE_NAME)
) {
  throw new Error(
    `SAFETY STOP: .env.test points DATABASE_URL at "${TEST_DATABASE_NAME}", ` +
      "which is not a dedicated test database. Automated tests create and " +
      "destroy fixture data (products, orders, seminar modules, FAQs, ...) " +
      "and must never touch the development database. Point .env.test at a " +
      'database whose name contains "test" (e.g. dacs_test_db) and run ' +
      "`npm run test:setup` to create/migrate it."
  );
}

// Mark the process so src/config/database.ts applies the same refusal —
// covers any code path that re-resolves DATABASE_URL later.
process.env.DACS_TEST_MODE ??= "1";

// Suites target the TEST server (default: the PORT in .env.test), never
// the dev server on :5000. An explicit TEST_BASE_URL still has to pass
// the assertTestServer() handshake below, so it cannot smuggle in a
// server that is attached to the dev database.
process.env.TEST_BASE_URL ??= `http://localhost:${process.env.PORT ?? "5001"}`;

export const TEST_BASE_URL = process.env.TEST_BASE_URL;

/**
 * Verify the server the suite is about to drive is connected to the
 * same dedicated test database this process is configured for. Call it
 * before the first request or Prisma write of every suite.
 */
export async function assertTestServer(): Promise<void> {
  let reportedName: string | null = null;
  try {
    const response = await fetch(`${TEST_BASE_URL}/api/health/database`);
    const body = (await response.json()) as { database?: string };
    reportedName = body?.database ?? null;
  } catch {
    throw new Error(
      `SAFETY STOP: no DACS backend is reachable at ${TEST_BASE_URL}. ` +
        "Start the TEST server first:  npm run dev:test  " +
        "(it loads .env.test and refuses to boot against a non-test database)."
    );
  }

  if (reportedName !== TEST_DATABASE_NAME) {
    throw new Error(
      `SAFETY STOP: the server at ${TEST_BASE_URL} reports database ` +
        `"${reportedName}", but this suite is configured for ` +
        `"${TEST_DATABASE_NAME}". Refusing to run — the suite would write ` +
        "fixture data through that server's database. Start the test server " +
        "with  npm run dev:test  and try again."
    );
  }

  console.log(
    `[test-env] server ${TEST_BASE_URL} confirmed on test database ` +
      `"${TEST_DATABASE_NAME}"`
  );
}
