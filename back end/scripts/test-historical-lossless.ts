/**
 * DACS lossless historical import E2E test.
 *
 * Run with the TEST server already started (npm run dev:test), then:
 *   npx tsx scripts/test-historical-lossless.ts
 *
 * Covers the historical_source_records layer end to end:
 *   - all three Dominant Asia sheet layouts import losslessly (every
 *     meaningful cell lands in a typed column and/or rawData)
 *   - existing customers are matched, never duplicated (DAPG preserved)
 *   - cross-sheet rows link to one customer; PS rows link a farm
 *   - malformed legacy values (Excel-date Module #/Seminar ID, bad
 *     phone) are flagged NEEDS_REVIEW and preserved verbatim
 *   - identity failures are preserved + flagged INVALID (not dropped)
 *   - re-upload and POST /files/:id/reimport are idempotent
 *   - the records API: pagination, filters, search, detail, review,
 *     RBAC (staff only)
 *
 * Hermetic: fixture emails use hist-lossless-*@dacs-test.example and
 * the workbook name below; everything is cleaned at start and end.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const WORKBOOK_NAME = "lossless-suite-workbook.xlsx";
const EMAIL = (slug: string) => `hist-lossless-${slug}@dacs-test.example`;
const EXISTING_DAPG = "DAPG-88888";

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail = ""): void {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function finish(): void {
  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;
  console.log(`\n========================================`);
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log(`========================================\n`);
  if (failed > 0) process.exitCode = 1;
}

async function api(
  pathName: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${pathName}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON response
  }

  return { status: response.status, body };
}

async function uploadWorkbook(
  token: string,
  buffer: Buffer,
  filename: string
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
  form.append("category", "Lossless Suite");

  const response = await fetch(`${BASE_URL}/api/historical/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON response
  }
  return { status: response.status, body };
}

async function getWebApiKey(projectId: string): Promise<string | null> {
  try {
    const credential = applicationDefault();
    const accessToken = await credential.getAccessToken();
    const headers = { Authorization: `Bearer ${accessToken.access_token}` };

    const appsResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps`,
      { headers }
    );
    const appsBody = (await appsResponse.json()) as {
      apps?: Array<{ name: string }>;
    };

    const firstApp = appsBody.apps?.[0];
    if (!firstApp) return null;

    const configResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/${firstApp.name}/config`,
      { headers }
    );
    const configBody = (await configResponse.json()) as { apiKey?: string };
    return configBody.apiKey ?? null;
  } catch {
    return process.env.FIREBASE_WEB_API_KEY ?? null;
  }
}

async function cleanupFixtures(): Promise<void> {
  await prisma.historicalSourceRecord.deleteMany({
    where: { sourceFilename: WORKBOOK_NAME },
  });
  await prisma.historicalFile.deleteMany({
    where: { originalName: WORKBOOK_NAME },
  });

  const fixtureProfiles = await prisma.customerProfile.findMany({
    where: { contactEmail: { startsWith: "hist-lossless-" } },
    select: { id: true },
  });
  const profileIds = fixtureProfiles.map((entry) => entry.id);
  if (profileIds.length > 0) {
    await prisma.farm.deleteMany({
      where: { customerProfileId: { in: profileIds } },
    });
    await prisma.customerProfile.deleteMany({
      where: { id: { in: profileIds } },
    });
  }
}

function buildWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  /* ---- Breeder Certificate Sheet (receiver/pickup logistics) ---- */
  const breederSheet = workbook.addWorksheet("Breeder Certificate Sheet");
  breederSheet.addRow([
    "Email Address",
    "Name",
    "Address",
    "Facebook and Messenger Account Name",
    "Contact Numbers",
    "Air/Land/Pick UP Location",
    "Cell. Phone Number of Receiver (if other than owner)",
    "Facebook and Messenger Account Name of Receiver (if other than owner)",
  ]);
  breederSheet.addRow([
    EMAIL("alpha"),
    "Alma B. Reyes",
    "12 Mango Street, Tagbilaran City, Bohol",
    "Alma Reyes",
    "0917-111-2222",
    "Tagbilaran Airport",
    "0917-333-4444",
    "Rico Receiver",
  ]);
  // Same email as the pre-existing DAPG-88888 profile: must MATCH, not
  // duplicate.
  breederSheet.addRow([
    EMAIL("existing"),
    "Elena Existing",
    "34 Narra Road, Cebu City, Cebu",
    "Elena Existing",
    "0917-555-6666",
    "Cebu-Mactan International Airport",
    "",
    "",
  ]);

  /* ---- Seminar Sheets (legacy participation) ---- */
  const seminarSheet = workbook.addWorksheet("Seminar Sheets");
  seminarSheet.addRow([
    "Name",
    "Occupation & Location",
    "Contact #",
    "Email",
    "Facebook",
    "Module #",
    "Pay Date",
    "Address",
    "Seminar ID #",
    "Registration Date",
  ]);
  seminarSheet.addRow([
    "Bruno C. Santos",
    "Farm Owner - Iloilo City",
    "0917-777-8888",
    EMAIL("bravo"),
    "Bruno Santos",
    7,
    new Date(Date.UTC(2026, 0, 11)),
    "7 Molave Street, Iloilo City, Iloilo",
    "SEM-2026-0777",
    new Date(Date.UTC(2026, 0, 4)),
  ]);
  // The known legacy artifact: Module # and Seminar ID # were formatted
  // as dates in Excel. Must be preserved + flagged, never guessed.
  seminarSheet.addRow([
    "Carla D. Artifact",
    "Operations Manager",
    9174515555,
    EMAIL("charlie"),
    "Carla Artifact",
    new Date(Date.UTC(2026, 2, 2)),
    new Date(Date.UTC(2026, 1, 26)),
    "Brgy. San Policarpo, Calbayog City",
    new Date(Date.UTC(2001, 2, 26)),
    new Date(Date.UTC(2026, 1, 26)),
  ]);
  // Questionable phone: preserved + flagged, the row still imports.
  seminarSheet.addRow([
    "Dana E. Phoney",
    "Teacher - Lucena City",
    "call me maybe",
    EMAIL("delta"),
    "Dana Phoney",
    5,
    new Date(Date.UTC(2026, 0, 9)),
    "5 Sampaguita Lane, Lucena City",
    "SEM-2026-0555",
    new Date(Date.UTC(2026, 0, 4)),
  ]);
  // Identity failure: invalid email. The ROW must still be preserved.
  seminarSheet.addRow([
    "Evan F. Broken",
    "Agriculturist",
    "0917-999-0000",
    "not-an-email",
    "Evan Broken",
    9,
    new Date(Date.UTC(2026, 0, 13)),
    "9 Rizal Street, Baguio City",
    "SEM-2026-0999",
    new Date(Date.UTC(2026, 0, 4)),
  ]);

  /* ---- PS Sheets (breeder/farm reports) ---- */
  const psSheet = workbook.addWorksheet("PS Sheets");
  psSheet.addRow([
    "Email Address",
    "Complete name of owner",
    "Farm name",
    "Complete farm address",
    "Contact numbers",
    "Facebook account name or Facebook Page name",
    "Date the breeders were acquired",
    "The number of heads per variety of existing breeders at the time of report",
    "Records of Vaccination",
    "Feeding, Health, Weight Management",
    "The number of heads per variety of existing breeders at the time of report (# of Breeders Claimed)",
    "(Optional) If you wish to include your farm logo on the breeder certificate, kindly attach the corresponding file or image below. ",
  ]);
  // Same person as breeder-cert row 1: one customer, two source records.
  psSheet.addRow([
    EMAIL("alpha"),
    "Alma B. Reyes",
    "Reyes Lossless Farm",
    "Sitio Uno, Brgy. Dao, Tagbilaran City, Bohol",
    "0917-111-2222",
    "Reyes Lossless Farm Page",
    new Date(Date.UTC(2025, 7, 4)),
    "D109 19F, 3M\nD128 17F, 4M",
    "Aug 11 IBD Gumboro\nAug 25 ND Lasota",
    "ADE Supplement\nProbiotic Mix\nFollowed per program",
    "D109: 22 heads; D128: 21 heads",
    "https://example.com/farm-logo/lossless.png",
  ]);
  psSheet.addRow([
    EMAIL("foxtrot"),
    "Feliza G. Uy",
    "Uy Golden Harvest Farm",
    "Sitio Dos, Brgy. Poblacion, Bacoor City, Cavite",
    "0917-222-3333",
    "Uy Golden Harvest Page",
    new Date(Date.UTC(2025, 7, 7)),
    "D116 20F, 4M",
    "Aug 14 ND Lasota",
    "Calfosvet\nStarter Crumble",
    "D116: 24 heads",
    "No logo submitted",
  ]);

  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer));
}

async function main(): Promise<void> {
  console.log(`\nDACS lossless historical import test against ${BASE_URL}\n`);
  await assertTestServer();

  const health = await api("/api/health");
  record("GET /api/health", health.status === 200 && health.body?.success === true);
  if (health.status !== 200) return finish();

  if (!firebaseAuth) {
    record("Firebase Admin initialized", false, "service-account JSON missing");
    return finish();
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8")) as {
    project_id: string;
  };
  const apiKey = await getWebApiKey(serviceAccount.project_id);
  if (!apiKey) {
    record("Fetch web API key", false, "set FIREBASE_WEB_API_KEY manually");
    return finish();
  }

  let testUser;
  try {
    testUser = await firebaseAuth.getUserByEmail(
      "dacs.farmer.fixture@dacs-test.example"
    );
  } catch {
    testUser = await firebaseAuth.createUser({
      email: "dacs.farmer.fixture@dacs-test.example",
      emailVerified: true,
      displayName: "DACS Backend Test User",
    });
  }

  const customToken = await firebaseAuth.createCustomToken(testUser.uid);
  const signInResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const token = ((await signInResponse.json()) as { idToken?: string }).idToken;
  record("Mint Firebase ID token", Boolean(token), testUser.email ?? "");
  if (!token) return finish();

  await api("/api/auth/sync", { method: "POST", token });
  const dacsUser = await prisma.user.findUnique({
    where: { firebaseUid: testUser.uid },
  });
  if (!dacsUser) {
    record("Find DACS user row", false, "no synced user for the Firebase UID");
    return finish();
  }
  const originalRole = dacsUser.role;

  await cleanupFixtures();

  // The claim-safe "already imported" customer the workbook must match.
  const existingProfile = await prisma.customerProfile.create({
    data: {
      customerNumber: EXISTING_DAPG,
      userId: null,
      firstName: "Elena",
      lastName: "Existing",
      contactEmail: EMAIL("existing"),
    },
  });

  await prisma.user.update({
    where: { id: dacsUser.id },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  let fileId: string | null = null;
  let secondFileId: string | null = null;

  try {
    const workbookBuffer = await buildWorkbookBuffer();

    // ---- A. First import: lossless + linked -----------------------------
    const upload = await uploadWorkbook(token, workbookBuffer, WORKBOOK_NAME);
    fileId = upload.body?.data?.file?.id ?? null;
    const summaries: any[] = upload.body?.data?.imports ?? [];
    const breederSummary = summaries.find(
      (entry) => entry.sheetName === "Breeder Certificate Sheet"
    );
    const seminarSummary = summaries.find(
      (entry) => entry.sheetName === "Seminar Sheets"
    );
    const psSummary = summaries.find((entry) => entry.sheetName === "PS Sheets");

    record(
      "A: upload -> breeder sheet: 2 records, 1 new + 1 matched customer",
      upload.status === 201 &&
        breederSummary?.rowsProcessed === 2 &&
        breederSummary?.sourceRecordsCreated === 2 &&
        breederSummary?.customersCreated === 1 &&
        breederSummary?.duplicateRows === 0 &&
        breederSummary?.errorRows === 0,
      `created=${breederSummary?.customersCreated} records=${breederSummary?.sourceRecordsCreated}`
    );

    record(
      "A: seminar sheet: 4 records, 3 customers, 1 identity error, 2 flagged",
      seminarSummary?.rowsProcessed === 4 &&
        seminarSummary?.sourceRecordsCreated === 4 &&
        seminarSummary?.customersCreated === 3 &&
        seminarSummary?.errorRows === 1 &&
        seminarSummary?.recordsFlagged === 3,
      `records=${seminarSummary?.sourceRecordsCreated} created=${seminarSummary?.customersCreated} err=${seminarSummary?.errorRows} flagged=${seminarSummary?.recordsFlagged}`
    );

    record(
      "A: PS sheet: 2 records, 1 new customer (alpha matched), 2 farms",
      psSummary?.rowsProcessed === 2 &&
        psSummary?.sourceRecordsCreated === 2 &&
        psSummary?.customersCreated === 1 &&
        psSummary?.farmsCreated === 2 &&
        psSummary?.errorRows === 0,
      `records=${psSummary?.sourceRecordsCreated} created=${psSummary?.customersCreated} farms=${psSummary?.farmsCreated}`
    );

    // ---- B. Matching never duplicates or renumbers ----------------------
    const existingAfter = await prisma.customerProfile.findMany({
      where: { contactEmail: EMAIL("existing") },
    });
    record(
      "B: pre-existing customer matched — one profile, DAPG preserved",
      existingAfter.length === 1 &&
        existingAfter[0]?.customerNumber === EXISTING_DAPG &&
        existingAfter[0]?.id === existingProfile.id,
      `profiles=${existingAfter.length} number=${existingAfter[0]?.customerNumber}`
    );

    const alphaProfiles = await prisma.customerProfile.findMany({
      where: { contactEmail: EMAIL("alpha") },
    });
    const alphaRecords = await prisma.historicalSourceRecord.findMany({
      where: { email: EMAIL("alpha") },
      orderBy: { sheetName: "asc" },
    });
    record(
      "B: cross-sheet rows link to ONE customer (2 records, 1 profile)",
      alphaProfiles.length === 1 &&
        alphaRecords.length === 2 &&
        alphaRecords.every(
          (entry) => entry.customerProfileId === alphaProfiles[0]?.id
        ),
      `profiles=${alphaProfiles.length} records=${alphaRecords.length}`
    );

    // ---- C. Field-level preservation ------------------------------------
    const breederRecord = alphaRecords.find(
      (entry) => entry.recordType === "BREEDER_CERTIFICATE"
    );
    record(
      "C: breeder-certificate fields preserved (pickup + receiver)",
      breederRecord?.pickupLocation === "Tagbilaran Airport" &&
        breederRecord?.receiverPhone === "0917-333-4444" &&
        breederRecord?.receiverFacebook === "Rico Receiver" &&
        breederRecord?.address === "12 Mango Street, Tagbilaran City, Bohol" &&
        breederRecord?.validationStatus === "VALID",
      `pickup=${breederRecord?.pickupLocation} receiver=${breederRecord?.receiverPhone}`
    );

    const psRecord = alphaRecords.find(
      (entry) => entry.recordType === "PARENT_STOCK"
    );
    const alphaFarm = await prisma.farm.findFirst({
      where: { farmName: "Reyes Lossless Farm" },
    });
    record(
      "C: PS fields preserved (heads, vaccination, management, claimed, logo)",
      psRecord?.breederHeads === "D109 19F, 3M\nD128 17F, 4M" &&
        psRecord?.vaccinationRecords === "Aug 11 IBD Gumboro\nAug 25 ND Lasota" &&
        psRecord?.managementRecords ===
          "ADE Supplement\nProbiotic Mix\nFollowed per program" &&
        psRecord?.breedersClaimed === "D109: 22 heads; D128: 21 heads" &&
        psRecord?.farmLogoUrl === "https://example.com/farm-logo/lossless.png" &&
        psRecord?.breedersAcquiredAt !== null &&
        psRecord?.farmId === alphaFarm?.id &&
        alphaFarm?.farmLogoUrl === "https://example.com/farm-logo/lossless.png",
      `farm=${psRecord?.farmId !== null} logo=${psRecord?.farmLogoUrl}`
    );

    const bravoRecord = await prisma.historicalSourceRecord.findFirst({
      where: { email: EMAIL("bravo") },
    });
    record(
      "C: seminar fields preserved (module 7, SEM ref, dates, occupation)",
      bravoRecord?.legacyModuleNumber === 7 &&
        bravoRecord?.legacyModuleRaw === "7" &&
        bravoRecord?.seminarReference === "SEM-2026-0777" &&
        bravoRecord?.registrationDate !== null &&
        bravoRecord?.payDate !== null &&
        bravoRecord?.occupation === "Farm Owner - Iloilo City" &&
        bravoRecord?.validationStatus === "VALID",
      `module=${bravoRecord?.legacyModuleNumber} ref=${bravoRecord?.seminarReference}`
    );

    const noLogoRecord = await prisma.historicalSourceRecord.findFirst({
      where: { email: EMAIL("foxtrot") },
    });
    record(
      "C: non-URL logo text preserved verbatim, no fake image URL",
      noLogoRecord?.farmLogoValue === "No logo submitted" &&
        noLogoRecord?.farmLogoUrl === null,
      `value=${noLogoRecord?.farmLogoValue}`
    );

    // ---- D. Legacy-data quality flags -----------------------------------
    const artifactRecord = await prisma.historicalSourceRecord.findFirst({
      where: { email: EMAIL("charlie") },
    });
    const artifactMessages = (artifactRecord?.validationMessages ?? []) as Array<{
      field: string;
      severity: string;
    }>;
    record(
      "D: Excel-date Module #/Seminar ID flagged NEEDS_REVIEW, preserved raw",
      artifactRecord?.validationStatus === "NEEDS_REVIEW" &&
        artifactRecord?.legacyModuleNumber === null &&
        artifactRecord?.legacyModuleRaw === "2026-03-02" &&
        artifactRecord?.seminarReference === "2001-03-26" &&
        artifactRecord?.customerProfileId !== null &&
        artifactMessages.some((entry) => entry.field === "legacyModule") &&
        artifactMessages.some((entry) => entry.field === "seminarReference"),
      `status=${artifactRecord?.validationStatus} moduleRaw=${artifactRecord?.legacyModuleRaw}`
    );

    const phoneyRecord = await prisma.historicalSourceRecord.findFirst({
      where: { email: EMAIL("delta") },
    });
    const phoneyProfile = await prisma.customerProfile.findFirst({
      where: { contactEmail: EMAIL("delta") },
    });
    record(
      "D: questionable phone flagged; raw kept on record, profile phone null",
      phoneyRecord?.validationStatus === "NEEDS_REVIEW" &&
        phoneyRecord?.phone === "call me maybe" &&
        phoneyProfile?.phoneNumber === null,
      `phone=${phoneyRecord?.phone}`
    );

    const brokenRecord = await prisma.historicalSourceRecord.findFirst({
      where: { fullName: "Evan F. Broken" },
    });
    record(
      "D: invalid-email row preserved as INVALID record (not dropped)",
      brokenRecord !== null &&
        brokenRecord?.validationStatus === "INVALID" &&
        brokenRecord?.customerProfileId === null &&
        brokenRecord?.email === "not-an-email" &&
        brokenRecord?.seminarReference === "SEM-2026-0999",
      `status=${brokenRecord?.validationStatus}`
    );

    // ---- E. Records API: pagination, filters, search, detail ------------
    const pageOne = await api(
      `/api/historical/records?recordType=SEMINAR&historicalFileId=${fileId}&page=1&pageSize=2`,
      { token }
    );
    record(
      "E: GET /records paginates server-side (total=4, page of 2)",
      pageOne.status === 200 &&
        pageOne.body?.total === 4 &&
        (pageOne.body?.items ?? []).length === 2,
      `total=${pageOne.body?.total} items=${pageOne.body?.items?.length}`
    );

    const needsReview = await api(
      `/api/historical/records?historicalFileId=${fileId}&validationStatus=NEEDS_REVIEW`,
      { token }
    );
    record(
      "E: validationStatus filter -> the two flagged seminar rows",
      needsReview.status === 200 && needsReview.body?.total === 2,
      `total=${needsReview.body?.total}`
    );

    const unlinked = await api(
      `/api/historical/records?historicalFileId=${fileId}&linked=false`,
      { token }
    );
    record(
      "E: linked=false filter -> only the INVALID identity row",
      unlinked.status === 200 &&
        unlinked.body?.total === 1 &&
        unlinked.body?.items?.[0]?.fullName === "Evan F. Broken",
      `total=${unlinked.body?.total}`
    );

    const searchFarm = await api(
      `/api/historical/records?search=${encodeURIComponent("Reyes Lossless Farm")}`,
      { token }
    );
    record(
      "E: search matches farm name",
      searchFarm.status === 200 &&
        searchFarm.body?.total === 1 &&
        searchFarm.body?.items?.[0]?.email === EMAIL("alpha"),
      `total=${searchFarm.body?.total}`
    );

    const searchDapg = await api(
      `/api/historical/records?search=${encodeURIComponent(EXISTING_DAPG)}`,
      { token }
    );
    record(
      "E: search matches linked customer number",
      searchDapg.status === 200 && searchDapg.body?.total === 1,
      `total=${searchDapg.body?.total}`
    );

    const detailId = psRecord?.id;
    const detail = await api(`/api/historical/records/${detailId}`, { token });
    const rawKeys = Object.keys(detail.body?.data?.rawData ?? {});
    record(
      "E: record detail returns rawData, file provenance and siblings",
      detail.status === 200 &&
        rawKeys.includes("Records of Vaccination") &&
        detail.body?.data?.import?.historicalFile?.originalName === WORKBOOK_NAME &&
        (detail.body?.data?.relatedRecords ?? []).some(
          (entry: any) => entry.recordType === "BREEDER_CERTIFICATE"
        ),
      `rawKeys=${rawKeys.length} related=${detail.body?.data?.relatedRecords?.length}`
    );

    // ---- F. Review workflow ---------------------------------------------
    const review = await api(
      `/api/historical/records/${artifactRecord?.id}/review`,
      {
        method: "PATCH",
        token,
        body: { notes: "Legacy Excel formatting confirmed — module unknown." },
      }
    );
    const reviewAgain = await api(
      `/api/historical/records/${artifactRecord?.id}/review`,
      { method: "PATCH", token, body: {} }
    );
    const reviewLog = await prisma.activityLog.findFirst({
      where: {
        module: "HISTORICAL",
        action: "HISTORICAL_RECORD_REVIEWED",
        recordId: artifactRecord?.id,
      },
    });
    record(
      "F: PATCH review -> 200 with audit log, reviewing again -> 409",
      review.status === 200 &&
        review.body?.data?.reviewedAt !== null &&
        reviewAgain.status === 409 &&
        reviewLog !== null,
      `${review.status} then ${reviewAgain.status}`
    );

    // ---- G. RBAC ---------------------------------------------------------
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: "CLIENT_FARMER" },
    });
    const farmerRecords = await api("/api/historical/records", { token });
    const farmerReimport = await api(`/api/historical/files/${fileId}/reimport`, {
      method: "POST",
      token,
    });
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: "ADMINISTRATIVE_STAFF" },
    });
    record(
      "G: farmer -> 403 on records + reimport (staff only)",
      farmerRecords.status === 403 && farmerReimport.status === 403,
      `records=${farmerRecords.status} reimport=${farmerReimport.status}`
    );

    // ---- H. Idempotency: re-upload + reimport ---------------------------
    const profileCountBefore = await prisma.customerProfile.count({
      where: { contactEmail: { startsWith: "hist-lossless-" } },
    });
    const farmCountBefore = await prisma.farm.count({
      where: { farmName: { in: ["Reyes Lossless Farm", "Uy Golden Harvest Farm"] } },
    });

    const reUpload = await uploadWorkbook(token, workbookBuffer, WORKBOOK_NAME);
    secondFileId = reUpload.body?.data?.file?.id ?? null;
    const reUploadTotals = (reUpload.body?.data?.imports ?? []).reduce(
      (totals: any, sheet: any) => ({
        duplicates: totals.duplicates + (sheet.duplicateRows ?? 0),
        records: totals.records + (sheet.sourceRecordsCreated ?? 0),
        customers: totals.customers + (sheet.customersCreated ?? 0),
        farms: totals.farms + (sheet.farmsCreated ?? 0),
      }),
      { duplicates: 0, records: 0, customers: 0, farms: 0 }
    );
    record(
      "H: re-upload -> all 8 rows duplicates, nothing created",
      reUpload.status === 201 &&
        reUploadTotals.duplicates === 8 &&
        reUploadTotals.records === 0 &&
        reUploadTotals.customers === 0 &&
        reUploadTotals.farms === 0,
      `dup=${reUploadTotals.duplicates} records=${reUploadTotals.records}`
    );

    const reimport = await api(`/api/historical/files/${fileId}/reimport`, {
      method: "POST",
      token,
    });
    const reimportTotals = (reimport.body?.data?.imports ?? []).reduce(
      (totals: any, sheet: any) => ({
        duplicates: totals.duplicates + (sheet.duplicateRows ?? 0),
        records: totals.records + (sheet.sourceRecordsCreated ?? 0),
      }),
      { duplicates: 0, records: 0 }
    );
    const reimportLog = await prisma.activityLog.findFirst({
      where: {
        module: "HISTORICAL",
        action: "HISTORICAL_FILE_REIMPORTED",
        recordId: fileId ?? undefined,
      },
    });
    record(
      "H: POST /files/:id/reimport -> idempotent + audit-logged",
      reimport.status === 200 &&
        reimportTotals.duplicates === 8 &&
        reimportTotals.records === 0 &&
        reimportLog !== null,
      `dup=${reimportTotals.duplicates} records=${reimportTotals.records}`
    );

    const profileCountAfter = await prisma.customerProfile.count({
      where: { contactEmail: { startsWith: "hist-lossless-" } },
    });
    const farmCountAfter = await prisma.farm.count({
      where: { farmName: { in: ["Reyes Lossless Farm", "Uy Golden Harvest Farm"] } },
    });
    const recordCountAfter = await prisma.historicalSourceRecord.count({
      where: { sourceFilename: WORKBOOK_NAME },
    });
    record(
      "H: profiles/farms/records unchanged after re-import runs",
      profileCountBefore === profileCountAfter &&
        farmCountBefore === farmCountAfter &&
        recordCountAfter === 8,
      `profiles=${profileCountAfter} farms=${farmCountAfter} records=${recordCountAfter}`
    );
  } finally {
    // ---- Cleanup ---------------------------------------------------------
    if (secondFileId) {
      await api(`/api/historical/files/${secondFileId}`, {
        method: "DELETE",
        token,
      });
    }
    if (fileId) {
      await api(`/api/historical/files/${fileId}`, { method: "DELETE", token });
    }
    await cleanupFixtures();
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: originalRole },
    });
    record("Cleanup complete (fixtures removed, role restored)", true);
  }

  finish();
}

main()
  .catch((error) => {
    console.error("Suite failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
