/*
 * One-command setup for the DACS automated-test database.
 *
 *   npm run test:setup
 *
 * Idempotent. Reads .env.test (via scripts/lib/test-env.ts, which also
 * refuses to run against anything that is not a dedicated test
 * database), then:
 *   1. Creates the test database if it does not exist yet — connecting
 *      to the maintenance database "postgres" with the same credentials
 *      (.env.test), never touching the development database.
 *   2. Applies all Prisma migrations (prisma migrate deploy).
 *   3. Seeds the five staff accounts (scripts/seed-staff-users.ts run
 *      with the test environment inherited) so the RBAC suites can sign
 *      in. The synthetic farmer fixture is get-or-created by the suites
 *      themselves on first run.
 *
 * After this: start the test server with `npm run dev:test`, then run
 * suites (npm run test:backend, ... or npm run test:all).
 */
import { execSync } from "node:child_process";

import { Client } from "pg";

import { BACKEND_ROOT, TEST_DATABASE_NAME } from "./lib/test-env";

async function ensureDatabaseExists(): Promise<void> {
  const testUrl = new URL(process.env.DATABASE_URL ?? "");

  // Same host/credentials, but the maintenance database — CREATE
  // DATABASE cannot run from a connection to the database being created.
  const adminUrl = new URL(testUrl.toString());
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [TEST_DATABASE_NAME]
    );
    if (existing.rowCount) {
      console.log(`Database "${TEST_DATABASE_NAME}" already exists.`);
      return;
    }

    // Identifier comes from .env.test and has already passed the
    // test-name validation in test-env.ts; quote it defensively anyway.
    await client.query(
      `CREATE DATABASE "${TEST_DATABASE_NAME.replace(/"/g, '""')}"`
    );
    console.log(`Created database "${TEST_DATABASE_NAME}".`);
  } finally {
    await client.end();
  }
}

function run(command: string): void {
  console.log(`\n$ ${command}`);
  // process.env already carries the .env.test values (loaded with
  // override by test-env.ts); children inherit them, and their own
  // `dotenv/config` calls never override existing variables — so every
  // child below runs against the test database.
  execSync(command, { cwd: BACKEND_ROOT, stdio: "inherit", env: process.env });
}

async function main(): Promise<void> {
  console.log(`Setting up test database "${TEST_DATABASE_NAME}"...`);

  await ensureDatabaseExists();

  run("npx prisma migrate deploy");
  run("npx tsx scripts/seed-staff-users.ts");

  console.log(
    `\nTest database "${TEST_DATABASE_NAME}" is ready.\n` +
      "Next steps:\n" +
      "  1. npm run dev:test        (starts the test server on the .env.test port)\n" +
      "  2. npm run test:backend    (or any other test:* suite, or test:all)\n"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
