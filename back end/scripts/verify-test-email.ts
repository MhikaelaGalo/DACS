/**
 * Development helper: marks a Firebase test user's email as verified.
 *
 *   npx tsx scripts/verify-test-email.ts <email>
 *
 * Uses the Admin SDK's updateUser({ emailVerified: true }) — for
 * development testing only; real users verify via the emailed link.
 */
import "dotenv/config";

import { firebaseAuth } from "../src/config/firebase";

const email = process.argv[2]?.trim();

if (!firebaseAuth) {
  console.error("Firebase Admin is not configured.");
  process.exit(1);
}

if (!email) {
  console.error("Usage: npx tsx scripts/verify-test-email.ts <email>");
  process.exit(1);
}

const user = await firebaseAuth.getUserByEmail(email);
await firebaseAuth.updateUser(user.uid, { emailVerified: true });

console.log(`Email ${email} is now marked as verified.`);
console.log(`Firebase UID: ${user.uid}`);
