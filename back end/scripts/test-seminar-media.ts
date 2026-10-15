// Dedicated local test database only. No Firebase calls and no real cloud uploads.
import "./lib/test-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { mock } from "node:test";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../src/config/database";
import { uploadCoverImage, addVideo, replaceVideoFile, removeCoverImage, deleteVideo, deleteModule } from "../src/modules/seminars/seminar.controller";
import { archiveSeminarCertificate } from "../src/services/seminarCertificate.service";
import { getSeminarModules, getMyCertificateFile, updateSeminarVideo } from "../src/modules/seminars/seminar.service";
import { resolveSeminarObject } from "../src/services/seminarStorage.service";
import type { Request, Response, NextFunction } from "express";

Object.assign(process.env, { SEMINAR_STORAGE_DRIVER: "neon", AWS_ENDPOINT_URL_S3: "https://storage.test", AWS_REGION: "ap-southeast-1", AWS_ACCESS_KEY_ID: "test-only", AWS_SECRET_ACCESS_KEY: "test-only" });
const objects = new Map<string, Buffer>();
let failUpload = false;
let failDelete = false;
let puts = 0;
mock.method(S3Client.prototype, "send", async (command: { input: { Bucket: string; Key: string; Body: Buffer } }) => {
  const { Bucket: bucket, Key: key } = command.input;
  const id = `${bucket}/${key}`;
  if (command instanceof PutObjectCommand) {
    if (failUpload) { failUpload = false; throw new Error("Simulated upload failure"); }
    puts++; objects.set(id, Buffer.from(command.input.Body)); return {};
  }
  if (command instanceof DeleteObjectCommand) {
    if (failDelete) { failDelete = false; throw new Error("Simulated cleanup failure"); }
    const allReferences = [
      ...(await prisma.seminarModule.findMany({ select: { coverImageUrl: true, certificateTemplateUrl: true } })).flatMap((row) => [row.coverImageUrl, row.certificateTemplateUrl]),
      ...(await prisma.seminarVideo.findMany({ select: { videoUrl: true } })).map((row) => row.videoUrl),
      ...(await prisma.certificateRequest.findMany({ select: { certificateFilePath: true } })).map((row) => row.certificateFilePath),
    ];
    assert(!allReferences.some((ref) => { const object = ref && resolveSeminarObject(ref); return object && `${object.bucket}/${object.key}` === id; }), "Deletion must occur after the last database reference is gone");
    objects.delete(id); return {};
  }
  if (command instanceof GetObjectCommand) {
    const bytes = objects.get(id); assert(bytes, "Private object exists");
    return { Body: { transformToByteArray: async () => bytes } };
  }
  throw new Error("Unexpected S3 operation");
});

const tag = randomUUID();
let ownerId = "";
const users: string[] = [];
const profiles: string[] = [];
const modules: string[] = [];
const actor = () => ({ id: ownerId, role: "OWNER_EXECUTIVE" });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.alloc(8)]);
type Result = { status: number; data?: any; error?: any };
async function invoke(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>, moduleId: string, file?: Buffer, videoId?: string) {
  const result: Result = { status: 200 };
  const req = { dacsUser: actor(), params: { moduleId, videoId }, headers: {}, body: { ...(file === mp4 ? { title: "Lesson", durationSeconds: "60" } : {}) },
    ...(file ? { file: { buffer: file, originalname: file === mp4 ? "lesson.mp4" : "cover.jpg" } } : {}) } as unknown as Request;
  if (handler === replaceVideoFile) req.body = { durationSeconds: "90" };
  const res = { status(code: number) { result.status = code; return this; }, json(body: any) { result.data = body.data; } } as unknown as Response;
  await handler(req, res, ((error: any) => { result.error = error; }) as NextFunction);
  return result;
}
function objectExists(reference: string) { const object = resolveSeminarObject(reference); return object && objects.has(`${object.bucket}/${object.key}`); }
function pass(message: string) { console.log(`PASS ${message}`); }

try {
  await prisma.$queryRaw`SELECT 1`;
  for (const role of ["OWNER_EXECUTIVE", "CLIENT_FARMER", "CLIENT_FARMER"] as const) {
    const user = await prisma.user.create({ data: { email: `${role}-${users.length}-${tag}@media-test.example`, role } }); users.push(user.id);
  }
  ownerId = users[0];
  for (const userId of users.slice(1)) {
    const profile = await prisma.customerProfile.create({ data: { userId, customerNumber: `MEDIA-${profiles.length}-${tag}`, firstName: "Test", lastName: "Farmer" } }); profiles.push(profile.id);
  }
  for (let index = 0; index < 2; index++) {
    const module = await prisma.seminarModule.create({ data: { moduleNumber: 900000 + Math.floor(Math.random() * 100000), title: "Media test", passingScore: 75, price: index === 0 ? 2700 : 0, isPublished: true } }); modules.push(module.id);
  }
  let result = await invoke(uploadCoverImage, modules[0], jpeg); assert(!result.error); let cover = result.data.coverImageUrl;
  assert(objectExists(cover));
  failUpload = true; result = await invoke(uploadCoverImage, modules[0], jpeg); assert(result.error);
  assert.equal((await prisma.seminarModule.findUniqueOrThrow({ where: { id: modules[0] } })).coverImageUrl, cover); assert(objectExists(cover));
  pass("Upload failure preserves the previous cover and database reference");
  await prisma.seminarModule.update({ where: { id: modules[0] }, data: { archivedAt: new Date() } });
  const beforeFailedSave = objects.size; result = await invoke(uploadCoverImage, modules[0], jpeg); assert.equal(result.error?.statusCode, 409); assert.equal(objects.size, beforeFailedSave); assert(objectExists(cover));
  await prisma.seminarModule.update({ where: { id: modules[0] }, data: { archivedAt: null } });
  pass("Database rejection cleans up only the unreferenced new upload");
  const oldCover = cover; failDelete = true; result = await invoke(uploadCoverImage, modules[0], jpeg); assert(!result.error); cover = result.data.coverImageUrl;
  assert.notEqual(oldCover, cover); assert(objectExists(cover)); assert(objectExists(oldCover));
  pass("Cleanup failure keeps the new cover usable and leaves a reviewable orphan");
  await prisma.seminarModule.update({ where: { id: modules[1] }, data: { coverImageUrl: cover } });
  result = await invoke(uploadCoverImage, modules[0], jpeg); assert(!result.error); assert(objectExists(cover)); cover = result.data.coverImageUrl;
  pass("Shared file references prevent another seminar's cover from being deleted");
  result = await invoke(addVideo, modules[0], mp4); assert(!result.error); const videoId = result.data.id;
  assert(result.data.videoUrl.startsWith("https://storage.test/")); assert(result.data.videoUrl.includes("X-Amz-Signature="));
  const video = await prisma.seminarVideo.findUniqueOrThrow({ where: { id: videoId } }); assert(video.videoUrl.startsWith("neon://"));
  const farmerCatalog = await getSeminarModules(false, users[1]); const locked = farmerCatalog.find((module) => module.id === modules[0]); assert.equal(locked?.videos[0].videoUrl, null);
  pass("Database stores stable private video references; locked farmers receive no playback URL");
  const uploadsBeforeForeignVideo = puts;
  result = await invoke(replaceVideoFile, modules[1], mp4, videoId);
  assert.equal(result.error?.statusCode, 404); assert.equal(puts, uploadsBeforeForeignVideo);
  pass("A video from another seminar cannot be replaced or consume an upload");
  const completedAt = new Date("2026-08-25T10:00:00Z");
  const enrollment = await prisma.seminarEnrollment.create({ data: { customerProfileId: profiles[0], moduleId: modules[0], completedAt } });
  await prisma.seminarProgress.create({ data: { enrollmentId: enrollment.id, videoId, progressPercent: 100 } });
  const certificate = await prisma.certificateRequest.create({ data: { customerProfileId: profiles[0], status: "APPROVED", certificateNumber: `SEM-TEST-${tag}`, certificateIssuedAt: completedAt, issuedAt: completedAt, validUntil: new Date("2028-08-25T10:00:00Z") } });
  result = await invoke(replaceVideoFile, modules[0], mp4, videoId); assert(!result.error);
  const replaced = await prisma.seminarVideo.findUniqueOrThrow({ where: { id: videoId } }); assert.notEqual(replaced.videoUrl, video.videoUrl); assert(!objectExists(video.videoUrl)); assert.equal(replaced.durationSeconds, 90);
  assert.equal(await prisma.seminarProgress.count({ where: { videoId, progressPercent: 100 } }), 1);
  assert.equal((await prisma.seminarEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).completedAt?.toISOString(), completedAt.toISOString());
  pass("Video replacement commits before deleting the old file and preserves completion history");
  await assert.rejects(updateSeminarVideo(ownerId, modules[0], videoId, { videoUrl: video.videoUrl, expectedVideoUrl: video.videoUrl }, {}), (error: any) => error.statusCode === 409);
  assert.equal((await prisma.seminarVideo.findUniqueOrThrow({ where: { id: videoId } })).videoUrl, replaced.videoUrl);
  pass("A stale replacement cannot overwrite the current video reference");
  const countBeforeForeign = puts; await assert.rejects(archiveSeminarCertificate(certificate.id, users[2]), (error: any) => error.statusCode === 404); assert.equal(puts, countBeforeForeign);
  process.env.SEMINAR_STORAGE_DRIVER = "local";
  assert.equal((await archiveSeminarCertificate(certificate.id, users[1])).stored, false);
  assert.equal((await prisma.certificateRequest.findUniqueOrThrow({ where: { id: certificate.id } })).certificateFilePath, null);
  assert.equal(puts, countBeforeForeign);
  process.env.SEMINAR_STORAGE_DRIVER = "neon";
  pass("Local mode preserves browser certificates without adding local file references to the shared database");
  await archiveSeminarCertificate(certificate.id, users[1]); const storedCertificate = await prisma.certificateRequest.findUniqueOrThrow({ where: { id: certificate.id } }); assert(storedCertificate.certificateFilePath?.startsWith("neon://"));
  const countBeforeRepeat = puts; await archiveSeminarCertificate(certificate.id, users[1]); assert.equal(puts, countBeforeRepeat);
  const object = resolveSeminarObject(storedCertificate.certificateFilePath!)!; const generated = objects.get(`${object.bucket}/${object.key}`)!;
  assert(generated.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))); await mkdir("uploads-test", { recursive: true }); await writeFile("uploads-test/certificate-media-preview.jpg", generated);
  assert.equal((await getMyCertificateFile(users[1], certificate.id)).storageReference, storedCertificate.certificateFilePath);
  await assert.rejects(getMyCertificateFile(users[2], certificate.id), (error: any) => error.statusCode === 404);
  assert.equal(storedCertificate.issuedAt?.toISOString(), completedAt.toISOString());
  pass("Certificate archive is private, owner checked, created once, and retains its original issue date");
  const legacy = await prisma.certificateRequest.create({ data: { customerProfileId: profiles[0], status: "APPROVED", certificateNumber: `LEGACY-TEST-${tag}`, certificateIssuedAt: completedAt, certificateFilePath: "dacs-certificates/unissued-test.jpg", fileUploadedAt: completedAt } });
  await assert.rejects(getMyCertificateFile(users[1], legacy.id), (error: any) => error.statusCode === 404);
  pass("A legacy uploaded certificate remains inaccessible to farmers before official issuance");
  result = await invoke(deleteVideo, modules[0], undefined, videoId); assert(!result.error); assert.equal(result.data.result, "ARCHIVED"); assert(objectExists(replaced.videoUrl));
  assert.equal((await prisma.certificateRequest.findUniqueOrThrow({ where: { id: certificate.id } })).certificateFilePath, storedCertificate.certificateFilePath);
  pass("Removing a watched video retains archived media, farmer progress, and certificates");
  result = await invoke(deleteModule, modules[0]); assert(!result.error); assert.equal(result.data.result, "ARCHIVED"); assert(objectExists(replaced.videoUrl)); assert(objectExists(cover));
  pass("Archiving an enrolled seminar preserves its files and certificates");
  result = await invoke(addVideo, modules[1], mp4); assert(!result.error); const disposable = await prisma.seminarVideo.findUniqueOrThrow({ where: { id: result.data.id } });
  result = await invoke(deleteModule, modules[1]); assert(!result.error); assert.equal(result.data.result, "DELETED"); assert(!objectExists(disposable.videoUrl));
  assert(objectExists(storedCertificate.certificateFilePath!)); pass("Permanent seminar deletion cleans media while preserving independent certificate storage");
  console.log("All seminar storage checks passed against the dedicated local test database and mocked cloud storage.");
} finally {
  if (profiles.length) {
    await prisma.certificateRequest.deleteMany({ where: { customerProfileId: { in: profiles } } });
    await prisma.seminarEnrollment.deleteMany({ where: { customerProfileId: { in: profiles } } });
  }
  if (modules.length) await prisma.seminarModule.deleteMany({ where: { id: { in: modules } } });
  if (users.length) {
    await prisma.activityLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.customerProfile.deleteMany({ where: { id: { in: profiles } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  mock.restoreAll(); await prisma.$disconnect();
}
