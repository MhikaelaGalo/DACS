/*
 * TEMPORARY helper for browser verification of the issued-certificate
 * workflow: rewinds the fixture farmer's certificate request to the
 * "approved, nothing uploaded" state (and removes its stored files) so
 * the Upload -> Issue flow can be walked through the admin UI.
 *
 * Test database only (test-env guard). Run: npx tsx scripts/tmp-reset-cert-fixture.ts
 */
import "./lib/test-env";

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import { prisma } from "../src/config/database";
import { PRIVATE_UPLOADS_ROOT } from "../src/services/fileStorage.service";

const FARMER_EMAIL = "dacs.farmer.fixture@dacs-test.example";

async function main(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: FARMER_EMAIL } });
  if (!user) throw new Error("Fixture farmer user not found.");
  const profile = await prisma.customerProfile.findFirst({
    where: { userId: user.id, archivedAt: null },
  });
  if (!profile) throw new Error("Fixture farmer profile not found.");

  const requests = await prisma.certificateRequest.findMany({
    where: { customerProfileId: profile.id },
    select: { id: true },
  });

  const filesDir = path.join(PRIVATE_UPLOADS_ROOT, "dacs-certificates");
  for (const request of requests) {
    if (existsSync(filesDir)) {
      for (const file of readdirSync(filesDir)) {
        if (file.startsWith(request.id)) unlinkSync(path.join(filesDir, file));
      }
    }
  }

  const reset = await prisma.certificateRequest.updateMany({
    where: { customerProfileId: profile.id },
    data: {
      certificateFilePath: null,
      certificateFileName: null,
      certificateFileMimeType: null,
      certificateFileSize: null,
      fileUploadedAt: null,
      fileUploadedByUserId: null,
      issuedAt: null,
      issuedByUserId: null,
      validUntil: null,
    },
  });

  console.log(
    `Reset ${reset.count} certificate request(s) for ${profile.customerNumber} to the un-uploaded state.`
  );
}

main().finally(async () => {
  await prisma.$disconnect();
});
