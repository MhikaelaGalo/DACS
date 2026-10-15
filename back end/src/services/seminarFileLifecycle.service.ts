import { prisma } from "../config/database";
import { deleteSeminarFile } from "./seminarStorage.service";

/** Run only after a committed database update. Retained archive rows count too. */
export async function deleteUnreferencedSeminarFile(reference: string): Promise<void> {
  try {
    const counts = await Promise.all([
      prisma.seminarModule.count({ where: { OR: [{ coverImageUrl: reference }, { certificateTemplateUrl: reference }] } }),
      prisma.seminarVideo.count({ where: { videoUrl: reference } }),
      prisma.certificateRequest.count({ where: { certificateFilePath: reference } }),
    ]);
    if (counts.some((count) => count > 0)) return;
    await deleteSeminarFile(reference);
  } catch {
    // Do not make an already-committed replacement fail. Never log a signed URL.
    console.warn("[seminar-storage] File cleanup deferred; review unreferenced objects.");
  }
}
