/**
 * Development helper: fully removes a SYNTHETIC test farmer account —
 * its farms, customer profile, notifications pointing at the profile,
 * the users row, and the Firebase account. Refuses non-test domains so
 * it can never delete a real customer.
 *
 *   npx tsx scripts/delete-test-farmer.ts <email>
 */
import "./lib/test-env";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const email = process.argv[2]?.trim().toLowerCase();

if (!email || !email.endsWith("@dacs-test.example")) {
  console.error(
    "Usage: npx tsx scripts/delete-test-farmer.ts <email @dacs-test.example>"
  );
  process.exit(1);
}

const user = await prisma.user.findUnique({
  where: { email },
  include: { customerProfile: { include: { farms: true } } },
});

if (user) {
  await prisma.$transaction(async (tx) => {
    if (user.customerProfile) {
      await tx.notification.deleteMany({
        where: { recordId: user.customerProfile.id },
      });
      await tx.farm.deleteMany({
        where: { customerProfileId: user.customerProfile.id },
      });
      await tx.customerProfile.delete({ where: { id: user.customerProfile.id } });
    }
    await tx.notification.deleteMany({ where: { userId: user.id } });
    await tx.notificationPreference.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });
  console.log(
    `Deleted users row ${user.id}` +
      (user.customerProfile
        ? ` + profile ${user.customerProfile.customerNumber} (${user.customerProfile.farms.length} farm(s))`
        : "")
  );
} else {
  console.log("No users row for that email.");
}

if (firebaseAuth) {
  try {
    const record = await firebaseAuth.getUserByEmail(email);
    await firebaseAuth.deleteUser(record.uid);
    console.log(`Deleted Firebase user ${record.uid}.`);
  } catch {
    console.log("No Firebase user for that email.");
  }
}

await prisma.$disconnect();
