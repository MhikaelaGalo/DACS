/*
 * File storage abstraction for DACS uploads.
 *
 * Current implementation: LOCAL DISK. Files are written under
 * <backend>/uploads/ and served by Express at /uploads/... — PostgreSQL
 * only ever stores the resulting URL.
 *
 * When DACS moves to cloud storage (e.g. Alibaba Cloud OSS or Firebase
 * Storage), only this file needs to change: keep the same two function
 * signatures and every endpoint keeps working.
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// UPLOADS_DIR lets the test environment (.env.test) keep its files in a
// separate folder (uploads-test) so test uploads never mix with real ones.
export const UPLOADS_ROOT = path.resolve(
  process.cwd(),
  process.env.UPLOADS_DIR ?? "uploads"
);

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ??
  `http://localhost:${process.env.PORT ?? 5000}`;

export async function saveFile(
  folder: string,
  filename: string,
  contents: Buffer
): Promise<string> {
  const directory = path.join(UPLOADS_ROOT, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), contents);

  return `${PUBLIC_BASE_URL}/uploads/${folder}/${filename}`;
}

/*
 * ---------- Private storage ----------
 *
 * Unlike UPLOADS_ROOT, nothing under PRIVATE_UPLOADS_ROOT is ever
 * mounted as a static route: these files (DACS-issued certificates) are
 * only readable through authenticated API endpoints that check
 * ownership. The database stores the path RELATIVE to this root, never
 * a URL, so no customer response can leak a fetchable location.
 */
export const PRIVATE_UPLOADS_ROOT = path.resolve(
  process.cwd(),
  process.env.PRIVATE_UPLOADS_DIR ?? "uploads-private"
);

export async function savePrivateFile(
  folder: string,
  filename: string,
  contents: Buffer
): Promise<string> {
  const directory = path.join(PRIVATE_UPLOADS_ROOT, folder);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), contents);

  // The stored reference is the relative path (POSIX separators so the
  // value is portable if storage ever moves off the local disk).
  return `${folder}/${filename}`;
}

/*
 * Resolves a stored relative path to an absolute filesystem path, or
 * null when the value would escape the private root (path traversal).
 */
export function resolvePrivateFile(relativePath: string): string | null {
  const filePath = path.resolve(PRIVATE_UPLOADS_ROOT, relativePath);

  if (
    filePath === PRIVATE_UPLOADS_ROOT ||
    !filePath.startsWith(PRIVATE_UPLOADS_ROOT + path.sep)
  ) {
    return null;
  }

  return filePath;
}

export async function deletePrivateFile(relativePath: string): Promise<void> {
  try {
    const filePath = resolvePrivateFile(relativePath);
    if (!filePath) return;
    await unlink(filePath);
  } catch {
    // Best effort: a missing or locked old file must not fail the request.
  }
}

export async function deleteFileByUrl(url: string): Promise<void> {
  try {
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith("/uploads/")) return;

    const relativePath = decodeURIComponent(
      pathname.slice("/uploads/".length)
    );
    const filePath = path.resolve(UPLOADS_ROOT, relativePath);

    // Path-traversal guard: never delete anything outside uploads/. The
    // trailing separator prevents a sibling like "uploads-old/" from
    // satisfying a bare prefix check.
    if (
      filePath !== UPLOADS_ROOT &&
      !filePath.startsWith(UPLOADS_ROOT + path.sep)
    )
      return;

    await unlink(filePath);
  } catch {
    // Best effort: a missing or locked old file must not fail the request.
  }
}
