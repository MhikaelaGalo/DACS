// Read-only inventory; no delete flag and no certificate bucket operations.
import "dotenv/config";
import { Client } from "pg";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { resolveSeminarObject, storageClient, storageConfiguration, usesNeonSeminarStorage } from "../src/services/seminarStorage.service";

if (!usesNeonSeminarStorage()) throw new Error("Set up Neon seminar storage before running its inventory report.");
const config = storageConfiguration();
const database = new Client({ connectionString: process.env.DATABASE_URL, options: "-c default_transaction_read_only=on" });
try {
  await database.connect();
  await database.query("BEGIN READ ONLY");
  const records = await database.query<{ reference: string }>(
    "SELECT cover_image_url AS reference FROM seminar_modules WHERE cover_image_url IS NOT NULL UNION ALL SELECT certificate_template_url FROM seminar_modules WHERE certificate_template_url IS NOT NULL UNION ALL SELECT video_url FROM seminar_videos"
  );
  const used = new Set(records.rows.flatMap(({ reference }) => {
    const object = resolveSeminarObject(reference);
    return object ? [`${object.bucket}/${object.key}`] : [];
  }));
  await database.query("ROLLBACK");
  const report: Array<{ bucket: string; key: string; bytes: number; status: string }> = [];
  const storage = storageClient();
  for (const bucket of [config.buckets.covers, config.buckets.videos]) {
    let continuation: string | undefined;
    do {
      const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "seminars/", ContinuationToken: continuation }));
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        const recent = !object.LastModified || Date.now() - object.LastModified.getTime() < 24 * 60 * 60 * 1000;
        report.push({ bucket, key: object.Key, bytes: object.Size ?? 0,
          status: used.has(`${bucket}/${object.Key}`) ? "referenced" : recent ? "recent-upload-review-later" : "unreferenced-review" });
      }
      continuation = page.NextContinuationToken;
    } while (continuation);
  }
  console.log(JSON.stringify({ readOnly: true, certificatesExcluded: true, objects: report }, null, 2));
} finally { await database.end(); }
