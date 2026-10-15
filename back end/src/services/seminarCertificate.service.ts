import path from "node:path";
import sharp from "sharp";
import { prisma } from "../config/database";
import { HttpError } from "../utils/httpError";
import { saveSeminarCertificate, usesNeonSeminarStorage } from "./seminarStorage.service";
import { deleteUnreferencedSeminarFile } from "./seminarFileLifecycle.service";

function xml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

/** Same template and overlay geometry as the customer certificate viewer. */
export async function renderSeminarCertificate(details: { name: string; number: string; date: Date }): Promise<Buffer> {
  const template = path.resolve(process.env.CERTIFICATE_TEMPLATE_PATH ?? path.join(process.cwd(), "assets", "certificate-template.jpg"));
  const metadata = await sharp(template).metadata();
  const width = metadata.width!;
  const height = metadata.height!;
  const boxes = [
    { top: 25, left: 25, width: 50, height: 5, text: details.name, size: 3.6, italic: false },
    { top: 31.8, left: 30, width: 40, height: 2.6, text: `ID# ${details.number}`, size: 1.7, italic: false },
    { top: 56, left: 25, width: 50, height: 3.5, text: `on ${details.date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" })}`, size: 2.2, italic: true },
  ];
  const overlays = boxes.map((box) => {
    const fontSize = Math.min(height * box.size / 100, (width * box.width / 100 - 20) / Math.max(1, box.text.length * 0.6));
    return `<rect x="${width * box.left / 100}" y="${height * box.top / 100}" width="${width * box.width / 100}" height="${height * box.height / 100}" fill="white"/><text x="${width / 2}" y="${height * (box.top + box.height / 2) / 100}" text-anchor="middle" dominant-baseline="central" font-family="Georgia, Times New Roman, serif" font-size="${fontSize}" font-style="${box.italic ? "italic" : "normal"}" fill="black">${xml(box.text)}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${overlays}</svg>`);
  return sharp(template).composite([{ input: svg }]).jpeg({ quality: 92 }).toBuffer();
}

/** Explicit View/Download action only. Seminar edits never call this function. */
export async function archiveSeminarCertificate(requestId: string, farmerUserId?: string) {
  const record = await prisma.certificateRequest.findFirst({
    where: { id: requestId, ...(farmerUserId ? { customerProfile: { userId: farmerUserId, archivedAt: null } } : {}) },
    include: { customerProfile: { select: { firstName: true, middleName: true, lastName: true, suffix: true } } },
  });
  if (!record) throw new HttpError(404, "Certificate was not found.");
  if (record.status !== "APPROVED" || !record.certificateNumber || !record.certificateIssuedAt) {
    throw new HttpError(409, "This certificate has not been approved yet.");
  }
  if (record.certificateFilePath) return { stored: true, fileName: record.certificateFileName, mimeType: record.certificateFileMimeType };
  // Until cloud storage is explicitly enabled, preserve browser generation.
  // Never add a new local-disk certificate reference to the shared database.
  if (!usesNeonSeminarStorage()) return { stored: false, fileName: null, mimeType: null };
  const profile = record.customerProfile;
  const name = [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(" ");
  const contents = await renderSeminarCertificate({ name, number: record.certificateNumber, date: record.issuedAt ?? record.certificateIssuedAt });
  const fileName = `dacs-certificate-${record.certificateNumber}.jpg`;
  const reference = await saveSeminarCertificate(fileName, contents);
  try {
    // Concurrent downloads keep the first completed archive. No dates/statuses change.
    const saved = await prisma.certificateRequest.updateMany({
      where: { id: record.id, certificateFilePath: null, status: "APPROVED" },
      data: { certificateFilePath: reference, certificateFileName: fileName, certificateFileMimeType: "image/jpeg", certificateFileSize: contents.length },
    });
    if (saved.count === 0) await deleteUnreferencedSeminarFile(reference);
  } catch (error) {
    await deleteUnreferencedSeminarFile(reference);
    throw error;
  }
  return { stored: true, fileName, mimeType: "image/jpeg" };
}
