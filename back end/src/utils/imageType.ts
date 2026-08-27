export interface DetectedImageType {
  extension: string;
  mimeType: string;
}

/*
 * Detects the real image type from the file's magic bytes instead of
 * trusting the filename or the client-supplied Content-Type. A renamed
 * .exe or .pdf will not pass this check.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return { extension: "png", mimeType: "image/png" };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }

  return null;
}

/*
 * Payment proofs additionally accept PDF receipts ("%PDF" magic bytes),
 * since proof of payment is a file upload, not strictly an image.
 */
export function detectProofType(buffer: Buffer): DetectedImageType | null {
  const image = detectImageType(buffer);
  if (image) return image;

  if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
    return { extension: "pdf", mimeType: "application/pdf" };
  }

  return null;
}

/*
 * Seminar video uploads accept the two formats browsers can play
 * natively everywhere: MP4 (ISO base media — "ftyp" box at offset 4,
 * which also covers .m4v/.mov containers) and WebM (Matroska EBML
 * header). Filenames and Content-Type are never trusted.
 */
export function detectVideoType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { extension: "mp4", mimeType: "video/mp4" };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { extension: "webm", mimeType: "video/webm" };
  }

  return null;
}
