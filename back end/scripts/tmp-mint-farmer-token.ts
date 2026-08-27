/* Temporary helper (deleted after use): prints a Firebase custom token
 * for the synthetic fixture farmer so UI verification can sign in. */
import "dotenv/config";

import { firebaseAuth } from "../src/config/firebase";

if (!firebaseAuth) throw new Error("Firebase Admin is not configured.");

const FIXTURE_UID = "Gy1LYUD76CVzo6V70IOJr4G3ya22";
const user = await firebaseAuth.getUser(FIXTURE_UID);
if (user.email !== "dacs.farmer.fixture@dacs-test.example") {
  throw new Error(`Unexpected account for uid: ${user.email}`);
}
console.log(await firebaseAuth.createCustomToken(FIXTURE_UID));
