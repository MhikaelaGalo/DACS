/**
 * Development helper: sets (or resets) an email/password credential on a
 * Firebase test account so the customer website's real sign-in form can
 * be exercised. For synthetic test fixtures only — never run this against
 * a real customer's account.
 *
 *   npx tsx scripts/set-farmer-password.ts <email> <password> [--verified]
 */
import "dotenv/config";

import { firebaseAuth } from "../src/config/firebase";

const email = process.argv[2]?.trim();
const password = process.argv[3];
const markVerified = process.argv.includes("--verified");

if (!firebaseAuth) {
  console.error("Firebase Admin is not configured.");
  process.exit(1);
}

if (!email || !password || password.length < 8) {
  console.error(
    "Usage: npx tsx scripts/set-farmer-password.ts <email> <password >= 8 chars> [--verified]"
  );
  process.exit(1);
}

const user = await firebaseAuth.getUserByEmail(email);
await firebaseAuth.updateUser(user.uid, {
  password,
  ...(markVerified ? { emailVerified: true } : {}),
});

console.log(`Password set for ${email} (uid ${user.uid}).`);
if (markVerified) console.log("Email marked verified.");
