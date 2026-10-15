import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { deleteFileByUrl, deletePrivateFile, saveFile, savePrivateFile } from "./fileStorage.service";
import { HttpError } from "../utils/httpError";

export type SeminarBucket = "covers" | "videos" | "certificates";
const bucketVariables = {
  covers: "SEMINAR_COVERS_BUCKET",
  videos: "SEMINAR_VIDEOS_BUCKET",
  certificates: "SEMINAR_CERTIFICATES_BUCKET",
} as const;
const bucketDefaults = {
  covers: "dacs-seminar-covers", videos: "dacs-seminar-videos", certificates: "dacs-farmer-certificates",
};

/** Explicit opt-in: absent credentials must never silently fall back in Neon mode. */
export function usesNeonSeminarStorage(): boolean {
  const driver = process.env.SEMINAR_STORAGE_DRIVER ?? "local";
  if (driver !== "local" && driver !== "neon") throw new HttpError(503, "The seminar storage configuration is invalid.");
  return driver === "neon";
}

export function storageConfiguration() {
  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new HttpError(503, "Seminar cloud storage is not configured. Contact the administrator.");
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new HttpError(503, "The seminar storage endpoint is invalid.");
  }
  const buckets = Object.fromEntries(Object.entries(bucketVariables).map(([kind, variable]) => [kind, process.env[variable] ?? bucketDefaults[kind as SeminarBucket]])) as Record<SeminarBucket, string>;
  const names = Object.values(buckets);
  if (new Set(names).size !== names.length || names.some((name) => !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name))) {
    throw new HttpError(503, "Use separate valid buckets for seminar covers, videos, and certificates.");
  }
  return { endpoint: url.origin, region, credentials: { accessKeyId, secretAccessKey }, buckets };
}

export function storageClient() {
  const { endpoint, region, credentials } = storageConfiguration();
  return new S3Client({ endpoint, region, credentials, forcePathStyle: true, maxAttempts: 3 });
}

function encodedKey(key: string) { return key.split("/").map(encodeURIComponent).join("/"); }

/** Only this application's buckets and managed prefixes may be read or deleted. */
export function resolveSeminarObject(reference: string): { bucket: string; key: string; kind: SeminarBucket } | null {
  if (!reference.startsWith("neon://") && !process.env.AWS_ENDPOINT_URL_S3) return null;
  const config = storageConfiguration();
  let bucket: string;
  let key: string;
  try {
    const url = new URL(reference);
    if (url.search || url.hash || url.username || url.password) return null;
    if (url.protocol === "neon:") { bucket = url.hostname; key = decodeURIComponent(url.pathname.slice(1)); }
    else {
      if (url.origin !== config.endpoint) return null;
      const parts = url.pathname.slice(1).split("/");
      bucket = decodeURIComponent(parts.shift() ?? "");
      key = decodeURIComponent(parts.join("/"));
    }
  } catch { return null; }
  const kind = (Object.keys(config.buckets) as SeminarBucket[]).find((entry) => config.buckets[entry] === bucket);
  if (!kind || !key.startsWith("seminars/") || key.split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return null;
  return { bucket, key, kind };
}

export async function saveSeminarFile(folder: string, filename: string, contents: Buffer, mimeType: string): Promise<string> {
  if (!usesNeonSeminarStorage()) return saveFile(folder, filename, contents);
  const kind: SeminarBucket = folder === "seminar-videos" ? "videos" : "covers";
  const bucket = storageConfiguration().buckets[kind];
  // UUIDs ensure replacements never overwrite an existing object's cached content.
  const key = `seminars/${folder}/${randomUUID()}-${filename}`;
  await storageClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: contents, ContentType: mimeType,
    CacheControl: kind === "covers" ? "public, max-age=31536000, immutable" : "private, max-age=0" }));
  return kind === "covers" ? `${storageConfiguration().endpoint}/${bucket}/${encodedKey(key)}` : `neon://${bucket}/${encodedKey(key)}`;
}

export async function saveSeminarCertificate(filename: string, contents: Buffer): Promise<string> {
  if (!usesNeonSeminarStorage()) return savePrivateFile("dacs-certificates", filename, contents);
  const bucket = storageConfiguration().buckets.certificates;
  const key = `seminars/certificates/${randomUUID()}-${filename}`;
  await storageClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: contents, ContentType: "image/jpeg", CacheControl: "private, no-store" }));
  return `neon://${bucket}/${encodedKey(key)}`;
}

export async function playableSeminarUrl(reference: string | null): Promise<string | null> {
  if (!reference?.startsWith("neon://")) return reference;
  const object = resolveSeminarObject(reference);
  if (!object || object.kind !== "videos") throw new HttpError(404, "The seminar video could not be found.");
  const configured = Number(process.env.SEMINAR_VIDEO_LINK_SECONDS ?? 3600);
  const expiresIn = Number.isInteger(configured) && configured >= 300 && configured <= 86400 ? configured : 3600;
  return getSignedUrl(storageClient(), new GetObjectCommand({ Bucket: object.bucket, Key: object.key }), { expiresIn });
}

export async function readStoredCertificate(reference: string): Promise<Buffer> {
  const object = resolveSeminarObject(reference);
  if (!object || object.kind !== "certificates") throw new HttpError(404, "The certificate file could not be found.");
  const response = await storageClient().send(new GetObjectCommand({ Bucket: object.bucket, Key: object.key }));
  if (!response.Body) throw new HttpError(404, "The certificate file could not be found.");
  return Buffer.from(await response.Body.transformToByteArray());
}

/** Caller checks database references first. Failed deletion becomes a reviewable orphan. */
export async function deleteSeminarFile(reference: string): Promise<void> {
  const object = resolveSeminarObject(reference);
  if (!object) {
    if (reference.startsWith("dacs-certificates/")) await deletePrivateFile(reference);
    else await deleteFileByUrl(reference);
    return;
  }
  await storageClient().send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
}
