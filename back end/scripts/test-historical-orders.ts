/**
 * DACS historical ORDER import E2E test.
 *
 * Run with the TEST server already started (npm run dev:test), then:
 *   npx tsx scripts/test-historical-orders.ts
 *
 * Covers the Orders-sheet importer end to end:
 *   - header-based sheet recognition (metadata sheets are skipped)
 *   - orders land in the real orders/order_items/payments tables with
 *     source = HISTORICAL_IMPORT, legacy createdAt, computed totals
 *   - customers are MATCHED (number > email > unambiguous name), never
 *     created; products resolve against the live catalog, never invented
 *   - spreadsheet arithmetic is recomputed; disagreements are flagged
 *   - invalid enums / unknown products / unknown customers / duplicate
 *     order numbers preserve the row and flag it instead of failing
 *   - no live side effects: no status history, no payment history, no
 *     staff notifications, no breeder monitoring
 *   - payment summaries import without proof files (source-marked)
 *   - OpenXML namespace-prefixed workbooks (the generator style ExcelJS
 *     cannot read directly) import through the lenient loader
 *   - re-upload and POST /files/:id/reimport are idempotent
 *   - the records API filters/searches ORDER records; farmers get 403
 *
 * Hermetic: fixture emails use hist-orders-*@dacs-test.example, order
 * numbers use HIST-TEST-* / HIST-NS-*, products use HIST-* codes;
 * everything is cleaned at start and end.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import { applicationDefault } from "firebase-admin/app";
import JSZip from "jszip";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const WORKBOOK_NAME = "orders-suite-workbook.xlsx";
const NS_WORKBOOK_NAME = "orders-suite-prefixed.xlsx";
const EMAIL = (slug: string) => `hist-orders-${slug}@dacs-test.example`;

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
  form.append("category", "Orders Suite");

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
  const fixtureProfiles = await prisma.customerProfile.findMany({
    where: { contactEmail: { startsWith: "hist-orders-" } },
    select: { id: true },
  });
  const profileIds = fixtureProfiles.map((entry) => entry.id);

  if (profileIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { customerProfileId: { in: profileIds } },
    });
  }
  await prisma.historicalSourceRecord.deleteMany({
    where: { sourceFilename: { in: [WORKBOOK_NAME, NS_WORKBOOK_NAME] } },
  });
  if (profileIds.length > 0) {
    // order_items cascade with their order.
    await prisma.order.deleteMany({
      where: { customerProfileId: { in: profileIds } },
    });
  }
  await prisma.historicalFile.deleteMany({
    where: { originalName: { in: [WORKBOOK_NAME, NS_WORKBOOK_NAME] } },
  });
  if (profileIds.length > 0) {
    await prisma.customerProfile.deleteMany({
      where: { id: { in: profileIds } },
    });
  }
  await prisma.product.deleteMany({
    where: { productCode: { in: ["HIST-VET-1", "HIST-PS-1"] } },
  });
}

const HEADERS = [
  "Order Number",
  "Customer Number",
  "Customer Name",
  "Customer Email",
  "Order Type",
  "Order Date",
  "Status",
  "Product Code",
  "Product Name",
  "Quantity",
  "Unit Price",
  "Line Total",
  "Shipping Fee",
  "Total Amount",
  "Date Needed",
  "Hatch Date",
  "Release Date",
  "Fulfillment Method",
  "Airport/Branch/Address",
  "Receiver Name",
  "Receiver Contact",
  "Receiver Facebook",
  "Payment Type",
  "Payment Amount",
  "Payment Date",
  "Payment Reference",
  "Payment Status",
  "Instructions / Notes",
];

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function buildWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders Test Sheet");
  sheet.addRow(HEADERS);

  // R1 (row 2): fully valid delivered VET order + FULL/VERIFIED payment.
  sheet.addRow([
    "HIST-TEST-0001", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-05-06"), "DELIVERED", "", "Hist Test Tonic", 3, 100, 300, 50,
    350, utcDate("2024-05-20"), "", "", "DELIVERY",
    "88 Acacia St., Lipa City, Batangas", "Anna T. Cruz", "0917-000-0001",
    "Anna Cruz", "FULL", "₱350.00", utcDate("2024-05-08"), "GCASH-123",
    "VERIFIED", "Call before delivery.",
  ]);

  // R2 (row 3): valid PENDING pickup order, no payment cells. The pickup
  // location must NOT be routed into any address column.
  sheet.addRow([
    "HIST-TEST-0002", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-06-01"), "PENDING", "", "Hist Test Tonic", 2, 100, 200, 0,
    200, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Anna T. Cruz", "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // R3 (row 4): spreadsheet arithmetic disagrees — DACS must recompute.
  sheet.addRow([
    "HIST-TEST-0003", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-06-10"), "APPROVED", "", "Hist Test Tonic", 4, 100, 999, 10,
    1009, "", "", "", "LBC_BRANCH", "LBC Lipa Branch", "Anna T. Cruz",
    "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // R4 (row 5): unknown product — preserved + flagged, no order.
  sheet.addRow([
    "HIST-TEST-0004", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-06-15"), "PENDING", "", "Ghost Elixir", 1, 100, 100, 0, 100,
    "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up", "Anna T. Cruz",
    "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // R5 (row 6): unknown customer — preserved + flagged, no order.
  sheet.addRow([
    "HIST-TEST-0005", "", "Zoe Nobody", EMAIL("nobody"), "VETERINARY_PRODUCT",
    utcDate("2024-06-20"), "PENDING", "", "Hist Test Tonic", 1, 100, 100, 0,
    100, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Zoe Nobody", "0917-000-0005", "Zoe Nobody", "", "", "", "", "", "",
  ]);

  // R6 (row 7): invalid order status — row INVALID, customer still linked.
  sheet.addRow([
    "HIST-TEST-0006", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-07-01"), "ON_HOLD", "", "Hist Test Tonic", 1, 100, 100, 0,
    100, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Anna T. Cruz", "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // R7 (row 8): duplicate order number (R1's) with different content.
  sheet.addRow([
    "HIST-TEST-0001", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-07-05"), "PENDING", "", "Hist Test Tonic", 9, 100, 900, 0,
    900, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Anna T. Cruz", "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // R8 (row 9): identity failure (no email) — preserved, INVALID.
  sheet.addRow([
    "HIST-TEST-0008", "", "No Email Person", "", "VETERINARY_PRODUCT",
    utcDate("2024-07-10"), "PENDING", "", "Hist Test Tonic", 1, 100, 100, 0,
    100, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "No Email Person", "0917-000-0008", "", "", "", "", "", "", "",
  ]);

  // R9 (row 10): PARENT_STOCK delivered with a release date. Must NOT
  // trigger breeder monitoring.
  sheet.addRow([
    "HIST-TEST-0009", "", "Anna T. Cruz", EMAIL("anna"), "PARENT_STOCK",
    utcDate("2024-02-01"), "DELIVERED", "", "Hist Test D999", 1, 2500, 2500,
    500, 3000, "", utcDate("2024-02-20"), utcDate("2024-03-01"), "AIRPORT",
    "Cebu-Mactan International Airport", "Anna T. Cruz", "0917-000-0001",
    "Anna Cruz", "FULL", 3000, utcDate("2024-02-05"), "BANK-999", "VERIFIED",
    "",
  ]);

  // R10 (row 11): matched by CUSTOMER NUMBER (email is on no profile);
  // payment date is unreadable — payment still recorded, date null.
  sheet.addRow([
    "HIST-TEST-0010", "DAPG-77002", "Ben Uy", EMAIL("ben-alt"),
    "VETERINARY_PRODUCT", utcDate("2024-08-01"), "PAYMENT_SUBMITTED", "",
    "Hist Test Tonic", 5, 100, 500, 0, 500, "", "", "", "DELIVERY",
    "12 Mabini St., Cebu City", "Ben Uy", "0917-000-0010", "Ben Uy", "FULL",
    500, "not-a-date", "MAYA-777", "SUBMITTED", "",
  ]);

  // R11 (row 12): matched by unambiguous NAME fallback (email unknown).
  sheet.addRow([
    "HIST-TEST-0011", "", "Carla Yap", EMAIL("carla-old"),
    "VETERINARY_PRODUCT", utcDate("2024-08-10"), "PENDING", "",
    "Hist Test Tonic", 1, 100, 100, 0, 100, "", "", "", "PICKUP",
    "Dominant Asia Farm Gate Pick-Up", "Carla Yap", "0917-000-0011",
    "Carla Yap", "", "", "", "", "", "",
  ]);

  // R12 (row 13): blank order number — DACS generates an OQ-* number.
  sheet.addRow([
    "", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    utcDate("2024-09-01"), "PENDING", "", "Hist Test Tonic", 6, 100, 600, 0,
    600, "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Anna T. Cruz", "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ]);

  // Metadata sheet with unrelated headers: must be skipped, not imported.
  const notes = workbook.addWorksheet("Reference");
  notes.addRow(["Field", "Allowed Values"]);
  notes.addRow(["Order Status", "PENDING, APPROVED"]);

  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}

/*
 * A minimal OpenXML-SDK-style workbook: namespace-prefixed parts + BOMs,
 * the exact structure ExcelJS chokes on without the lenient loader.
 * One valid PENDING order row for Anna.
 */
function buildPrefixedWorkbookBuffer(): Promise<Buffer> {
  const BOM = "\uFEFF";
  const zip = new JSZip();

  const escape = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const columnRef = (index: number): string =>
    index < 26
      ? String.fromCharCode(65 + index)
      : `A${String.fromCharCode(65 + (index - 26))}`;

  const row = (rowNumber: number, cells: string[]): string =>
    `<x:row r="${rowNumber}">${cells
      .map(
        (value, index) =>
          `<x:c r="${columnRef(index)}${rowNumber}" t="inlineStr"><x:is><x:t>${escape(value)}</x:t></x:is></x:c>`
      )
      .join("")}</x:row>`;

  const dataRow = [
    "HIST-NS-0001", "", "Anna T. Cruz", EMAIL("anna"), "VETERINARY_PRODUCT",
    "2024-10-01", "PENDING", "", "Hist Test Tonic", "2", "100", "200", "0",
    "200", "", "", "", "PICKUP", "Dominant Asia Farm Gate Pick-Up",
    "Anna T. Cruz", "0917-000-0001", "Anna Cruz", "", "", "", "", "", "",
  ];

  zip.file(
    "[Content_Types].xml",
    `${BOM}<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`
  );
  zip.file(
    "_rels/.rels",
    `${BOM}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="R1" /></Relationships>`
  );
  zip.file(
    "xl/workbook.xml",
    `${BOM}<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Legacy Orders" sheetId="1" r:id="R2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${BOM}<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R2" /></Relationships>`
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `${BOM}<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${row(1, HEADERS)}${row(2, dataRow)}</x:sheetData></x:worksheet>`
  );

  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

async function main(): Promise<void> {
  console.log(`\nDACS historical orders import test against ${BASE_URL}\n`);
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

  // Fixture customers the workbook must MATCH (never duplicate).
  const anna = await prisma.customerProfile.create({
    data: {
      customerNumber: "DAPG-77001",
      firstName: "Anna",
      middleName: "T.",
      lastName: "Cruz",
      contactEmail: EMAIL("anna"),
    },
  });
  const ben = await prisma.customerProfile.create({
    data: {
      customerNumber: "DAPG-77002",
      firstName: "Ben",
      lastName: "Uy",
      contactEmail: EMAIL("ben"),
    },
  });
  const carla = await prisma.customerProfile.create({
    data: {
      customerNumber: "DAPG-77003",
      firstName: "Carla",
      lastName: "Yap",
      contactEmail: EMAIL("carla"),
    },
  });

  // Fixture catalog products the order lines must resolve against.
  const tonic = await prisma.product.create({
    data: {
      productCode: "HIST-VET-1",
      name: "Hist Test Tonic",
      category: "VETERINARY_PRODUCT",
      unitPrice: 120, // deliberately differs from the sheet's 100 snapshot
      isActive: true,
    },
  });
  await prisma.product.create({
    data: {
      productCode: "HIST-PS-1",
      name: "Hist Test D999",
      category: "PARENT_STOCK",
      unitPrice: 2500,
      isActive: true,
    },
  });

  await prisma.user.update({
    where: { id: dacsUser.id },
    data: { role: "ADMINISTRATIVE_STAFF" },
  });

  const profilesBefore = await prisma.customerProfile.count();
  const newOrderNotificationsBefore = await prisma.notification.count({
    where: { type: "NEW_ORDER" },
  });

  let fileId: string | null = null;
  let nsFileId: string | null = null;

  try {
    const workbookBuffer = await buildWorkbookBuffer();

    // ---- A. First import: normalized orders + preserved rows ----------
    const upload = await uploadWorkbook(token, workbookBuffer, WORKBOOK_NAME);
    fileId = upload.body?.data?.file?.id ?? null;
    const sheetRun = (upload.body?.data?.imports ?? []).find(
      (run: any) => run.sheetName === "Orders Test Sheet"
    );
    const skippedRun = (upload.body?.data?.imports ?? []).find(
      (run: any) => run.sheetName === "Reference"
    );

    record(
      "Upload imports the orders sheet (counts)",
      upload.status === 201 &&
        sheetRun?.rowsProcessed === 12 &&
        sheetRun?.sourceRecordsCreated === 12 &&
        sheetRun?.ordersCreated === 7 &&
        sheetRun?.orderItemsCreated === 7 &&
        sheetRun?.paymentsCreated === 3 &&
        sheetRun?.customersCreated === 0 &&
        sheetRun?.customersMatched === 3 &&
        sheetRun?.duplicateOrderNumbers === 1 &&
        sheetRun?.errorRows === 1 &&
        sheetRun?.recordsFlagged === 7,
      `status=${upload.status} run=${JSON.stringify(sheetRun ?? null)}`
    );
    record(
      "Metadata sheet is skipped by header recognition",
      Boolean(skippedRun?.skipped),
      skippedRun?.skipped ?? "no skip reported"
    );
    record(
      "Unmatched product reported by name",
      Array.isArray(sheetRun?.unmatchedProducts) &&
        sheetRun.unmatchedProducts.includes("Ghost Elixir"),
      JSON.stringify(sheetRun?.unmatchedProducts ?? null)
    );

    // ---- B. Normalized order data is correct in PostgreSQL ------------
    const order1 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0001" },
      include: { items: true, payments: true, statusHistory: true },
    });
    record(
      "HIST-TEST-0001: order row fully normalized",
      Boolean(order1) &&
        order1!.customerProfileId === anna.id &&
        order1!.source === "HISTORICAL_IMPORT" &&
        order1!.status === "DELIVERED" &&
        order1!.orderType === "VETERINARY_PRODUCT" &&
        order1!.createdAt.toISOString().slice(0, 10) === "2024-05-06" &&
        order1!.subtotal.toString() === "300" &&
        order1!.feeTotal.toString() === "50" &&
        order1!.totalAmount.toString() === "350" &&
        order1!.fulfillmentMethod === "DELIVERY" &&
        order1!.deliveryAddress === "88 Acacia St., Lipa City, Batangas" &&
        order1!.airportLocation === null &&
        order1!.instructions === "Call before delivery.",
      order1
        ? `total=${order1.totalAmount} created=${order1.createdAt.toISOString()}`
        : "order missing"
    );
    record(
      "HIST-TEST-0001: item snapshots correct",
      order1?.items.length === 1 &&
        order1.items[0].productId === tonic.id &&
        order1.items[0].productCodeSnapshot === "HIST-VET-1" &&
        order1.items[0].productNameSnapshot === "Hist Test Tonic" &&
        order1.items[0].unitPriceSnapshot.toString() === "100" &&
        order1.items[0].quantity === 3 &&
        order1.items[0].lineTotal.toString() === "300",
      JSON.stringify(
        order1?.items.map((item) => ({
          code: item.productCodeSnapshot,
          price: item.unitPriceSnapshot,
          qty: item.quantity,
        })) ?? null
      )
    );
    record(
      "HIST-TEST-0001: payment summary without proof",
      order1?.payments.length === 1 &&
        order1.payments[0].paymentType === "FULL" &&
        order1.payments[0].amount.toString() === "350" &&
        order1.payments[0].status === "VERIFIED" &&
        order1.payments[0].source === "HISTORICAL_IMPORT" &&
        order1.payments[0].referenceNumber === "GCASH-123" &&
        order1.payments[0].proofOriginalName === null &&
        order1.payments[0].proofStorageUrl === null &&
        order1.payments[0].paymentDate?.toISOString().slice(0, 10) ===
          "2024-05-08",
      JSON.stringify(order1?.payments[0] ?? null)
    );
    record(
      "No fake audit: imported orders carry no status history",
      order1?.statusHistory.length === 0
    );

    const paymentHistoryCount = await prisma.paymentStatusHistory.count({
      where: { payment: { order: { orderNumber: { startsWith: "HIST-TEST-" } } } },
    });
    record("No fake audit: no payment status history", paymentHistoryCount === 0);

    const order2 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0002" },
    });
    record(
      "PICKUP rows get no fabricated address/airport/branch",
      Boolean(order2) &&
        order2!.fulfillmentMethod === "PICKUP" &&
        order2!.deliveryAddress === null &&
        order2!.airportLocation === null &&
        order2!.pickupBranch === null,
      order2 ? "clean" : "order missing"
    );

    record(
      "Imported orders carry no payment deadline (never auto-cancelled)",
      order1?.paymentDeadlineAt === null && order2?.paymentDeadlineAt === null,
      `deadlines=${order1?.paymentDeadlineAt}/${order2?.paymentDeadlineAt}`
    );

    const recordOnHistorical = await api(
      `/api/payments/orders/${order2?.id}/record`,
      {
        method: "POST",
        token,
        body: { paymentType: "FULL", amount: 100 },
      }
    );
    record(
      "Staff cannot record a payment against a historical order -> 409",
      recordOnHistorical.status === 409,
      recordOnHistorical.body?.message ?? `status ${recordOnHistorical.status}`
    );

    const order3 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0003" },
    });
    const record3 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0003" },
    });
    record(
      "Arithmetic mismatch: computed totals stored, row flagged",
      order3?.subtotal.toString() === "400" &&
        order3.totalAmount.toString() === "410" &&
        record3?.validationStatus === "NEEDS_REVIEW" &&
        JSON.stringify(record3.validationMessages).includes("disagrees"),
      `subtotal=${order3?.subtotal} status=${record3?.validationStatus}`
    );

    const record4 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0004" },
    });
    record(
      "Unknown product: preserved, flagged, no order",
      record4?.validationStatus === "NEEDS_REVIEW" &&
        record4.orderId === null &&
        record4.customerProfileId === anna.id &&
        (record4.rawData as any)["Product Name"] === "Ghost Elixir"
    );

    const record5 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0005" },
    });
    record(
      "Unknown customer: preserved, flagged, unlinked, no order",
      record5?.validationStatus === "NEEDS_REVIEW" &&
        record5.orderId === null &&
        record5.customerProfileId === null
    );

    const record6 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0006" },
    });
    record(
      "Invalid status enum: row INVALID, customer still linked, no order",
      record6?.validationStatus === "INVALID" &&
        record6.orderId === null &&
        record6.customerProfileId === anna.id &&
        (record6.rawData as any)["Status"] === "ON_HOLD"
    );

    const dupNumberRecords = await prisma.historicalSourceRecord.findMany({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0001" },
      orderBy: { rowNumber: "asc" },
    });
    record(
      "Duplicate order number: second row preserved for review, one order only",
      dupNumberRecords.length === 2 &&
        dupNumberRecords[0].orderId !== null &&
        dupNumberRecords[1].orderId === null &&
        dupNumberRecords[1].validationStatus === "NEEDS_REVIEW" &&
        (await prisma.order.count({
          where: { orderNumber: "HIST-TEST-0001" },
        })) === 1
    );

    const importErrors = await prisma.importError.findMany({
      where: { importId: sheetRun?.importId ?? "" },
    });
    const record8 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0008" },
    });
    record(
      "Identity failure: INVALID record + INCOMPLETE import error",
      importErrors.length === 1 &&
        importErrors[0].errorType === "INCOMPLETE" &&
        record8?.validationStatus === "INVALID" &&
        record8.orderId === null
    );

    const order9 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0009" },
      include: { breederMonitoring: true },
    });
    record(
      "PS order: releasedAt stored, NO breeder monitoring triggered",
      order9?.orderType === "PARENT_STOCK" &&
        order9.status === "DELIVERED" &&
        order9.releasedAt?.toISOString().slice(0, 10) === "2024-03-01" &&
        order9.hatchDate?.toISOString().slice(0, 10) === "2024-02-20" &&
        order9.breederMonitoring === null,
      order9 ? `releasedAt=${order9.releasedAt?.toISOString()}` : "missing"
    );

    const order10 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0010" },
      include: { payments: true },
    });
    record(
      "Customer Number match wins over unknown email",
      order10?.customerProfileId === ben.id &&
        order10.payments.length === 1 &&
        order10.payments[0].paymentDate === null,
      order10 ? "matched DAPG-77002" : "missing"
    );

    const order11 = await prisma.order.findUnique({
      where: { orderNumber: "HIST-TEST-0011" },
    });
    const record11 = await prisma.historicalSourceRecord.findFirst({
      where: { sourceFilename: WORKBOOK_NAME, orderNumber: "HIST-TEST-0011" },
    });
    record(
      "Unambiguous name fallback matches (VALID, with info note)",
      order11?.customerProfileId === carla.id &&
        record11?.validationStatus === "VALID" &&
        JSON.stringify(record11.validationMessages).includes("by name")
    );

    const generatedRecord = await prisma.historicalSourceRecord.findFirst({
      where: {
        sourceFilename: WORKBOOK_NAME,
        orderNumber: { startsWith: "OQ-VET-" },
      },
      include: { order: { select: { orderNumber: true, source: true } } },
    });
    record(
      "Blank order number: OQ-* generated and order created",
      Boolean(generatedRecord?.order) &&
        generatedRecord!.order!.source === "HISTORICAL_IMPORT",
      generatedRecord?.orderNumber ?? "not generated"
    );

    // ---- C. No live side effects --------------------------------------
    const newOrderNotificationsAfter = await prisma.notification.count({
      where: { type: "NEW_ORDER" },
    });
    record(
      "No staff notifications from historical import",
      newOrderNotificationsAfter === newOrderNotificationsBefore
    );
    const profilesAfter = await prisma.customerProfile.count();
    record(
      "No customer profiles created by the orders sheet",
      profilesAfter === profilesBefore
    );

    // ---- D. Records API: filters, search, detail, RBAC ----------------
    const listAll = await api(
      `/api/historical/records?recordType=ORDER&historicalFileId=${fileId}&pageSize=20`,
      { token }
    );
    record(
      "GET /records filters recordType=ORDER",
      listAll.status === 200 &&
        listAll.body?.total === 12 &&
        listAll.body?.items?.every((item: any) => item.recordType === "ORDER"),
      `total=${listAll.body?.total}`
    );

    const searchNumber = await api(
      `/api/historical/records?search=HIST-TEST-0002&historicalFileId=${fileId}`,
      { token }
    );
    record(
      "Search by order number",
      searchNumber.status === 200 &&
        searchNumber.body?.total === 1 &&
        searchNumber.body?.items?.[0]?.orderNumber === "HIST-TEST-0002" &&
        searchNumber.body?.items?.[0]?.order?.items?.[0]?.productNameSnapshot ===
          "Hist Test Tonic",
      `total=${searchNumber.body?.total}`
    );

    const searchProduct = await api(
      `/api/historical/records?search=${encodeURIComponent("Hist Test D999")}&historicalFileId=${fileId}`,
      { token }
    );
    record(
      "Search by product name (via linked order)",
      searchProduct.status === 200 &&
        searchProduct.body?.total === 1 &&
        searchProduct.body?.items?.[0]?.orderNumber === "HIST-TEST-0009",
      `total=${searchProduct.body?.total}`
    );

    const reviewFilter = await api(
      `/api/historical/records?validationStatus=NEEDS_REVIEW&historicalFileId=${fileId}&pageSize=20`,
      { token }
    );
    record(
      "Needs-review filter isolates flagged order rows",
      reviewFilter.status === 200 && reviewFilter.body?.total === 5,
      `total=${reviewFilter.body?.total}`
    );

    const detailId = dupNumberRecords[0].id;
    const detail = await api(`/api/historical/records/${detailId}`, { token });
    record(
      "Record detail carries the full normalized order + payments + raw cells",
      detail.status === 200 &&
        detail.body?.data?.order?.orderNumber === "HIST-TEST-0001" &&
        detail.body?.data?.order?.items?.length === 1 &&
        detail.body?.data?.order?.payments?.length === 1 &&
        detail.body?.data?.order?.payments?.[0]?.proofStorageUrl === null &&
        detail.body?.data?.rawData?.["Payment Amount"] === "₱350.00",
      `order=${detail.body?.data?.order?.orderNumber}`
    );

    // ---- E. Admin orders API shows the imported orders ----------------
    const staffOrders = await api("/api/orders", { token });
    const listedHistorical = (staffOrders.body?.data ?? []).filter(
      (entry: any) => entry.orderNumber?.startsWith("HIST-TEST-")
    );
    record(
      "GET /api/orders lists imported orders with source flag",
      staffOrders.status === 200 &&
        listedHistorical.length === 6 &&
        listedHistorical.every(
          (entry: any) => entry.source === "HISTORICAL_IMPORT"
        ),
      `historical listed=${listedHistorical.length}`
    );

    const orderDetail = await api(`/api/orders/${order1!.id}`, { token });
    record(
      "GET /api/orders/:id includes historical payment summaries",
      orderDetail.status === 200 &&
        orderDetail.body?.data?.source === "HISTORICAL_IMPORT" &&
        orderDetail.body?.data?.payments?.length === 1 &&
        orderDetail.body?.data?.payments?.[0]?.proofStorageUrl === null,
      `payments=${orderDetail.body?.data?.payments?.length}`
    );

    // ---- F. Namespace-prefixed workbook (lenient loader) --------------
    const prefixedBuffer = await buildPrefixedWorkbookBuffer();
    const nsUpload = await uploadWorkbook(token, prefixedBuffer, NS_WORKBOOK_NAME);
    nsFileId = nsUpload.body?.data?.file?.id ?? null;
    const nsRun = (nsUpload.body?.data?.imports ?? []).find(
      (run: any) => run.sheetName === "Legacy Orders"
    );
    record(
      "Namespace-prefixed workbook imports via the lenient loader",
      nsUpload.status === 201 &&
        nsRun?.ordersCreated === 1 &&
        (await prisma.order.count({
          where: { orderNumber: "HIST-NS-0001", source: "HISTORICAL_IMPORT" },
        })) === 1,
      `status=${nsUpload.status} run=${JSON.stringify(nsRun ?? null)}`
    );

    // ---- G. Idempotency: re-upload + re-import ------------------------
    const ordersBeforeRerun = await prisma.order.count();
    const paymentsBeforeRerun = await prisma.payment.count();
    const itemsBeforeRerun = await prisma.orderItem.count();

    const reupload = await uploadWorkbook(token, workbookBuffer, WORKBOOK_NAME);
    const reuploadRun = (reupload.body?.data?.imports ?? []).find(
      (run: any) => run.sheetName === "Orders Test Sheet"
    );
    const reuploadFileId = reupload.body?.data?.file?.id ?? null;
    record(
      "Re-upload: every row is a duplicate, nothing created",
      reupload.status === 201 &&
        reuploadRun?.duplicateRows === 12 &&
        reuploadRun?.sourceRecordsCreated === 0 &&
        reuploadRun?.ordersCreated === 0 &&
        reuploadRun?.paymentsCreated === 0,
      JSON.stringify({
        duplicates: reuploadRun?.duplicateRows,
        orders: reuploadRun?.ordersCreated,
      })
    );
    if (reuploadFileId) {
      await api(`/api/historical/files/${reuploadFileId}`, {
        method: "DELETE",
        token,
      });
    }

    const reimport = await api(`/api/historical/files/${fileId}/reimport`, {
      method: "POST",
      token,
    });
    const reimportRun = (reimport.body?.data?.imports ?? []).find(
      (run: any) => run.sheetName === "Orders Test Sheet"
    );
    record(
      "Re-import endpoint: idempotent",
      reimport.status === 200 &&
        reimportRun?.duplicateRows === 12 &&
        reimportRun?.ordersCreated === 0,
      JSON.stringify({ duplicates: reimportRun?.duplicateRows })
    );

    const ordersAfterRerun = await prisma.order.count();
    const paymentsAfterRerun = await prisma.payment.count();
    const itemsAfterRerun = await prisma.orderItem.count();
    record(
      "Order/item/payment totals unchanged after re-runs",
      ordersAfterRerun === ordersBeforeRerun &&
        paymentsAfterRerun === paymentsBeforeRerun &&
        itemsAfterRerun === itemsBeforeRerun,
      `orders ${ordersBeforeRerun}->${ordersAfterRerun}`
    );

    // ---- H. RBAC: farmers cannot reach historical order data ----------
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: "CLIENT_FARMER" },
    });
    const farmerRecords = await api(
      "/api/historical/records?recordType=ORDER",
      { token }
    );
    const farmerOrders = await api("/api/orders", { token });
    record(
      "Farmer gets 403 on historical records and staff orders",
      farmerRecords.status === 403 && farmerOrders.status === 403,
      `records=${farmerRecords.status} orders=${farmerOrders.status}`
    );
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: "ADMINISTRATIVE_STAFF" },
    });
  } finally {
    await prisma.user.update({
      where: { id: dacsUser.id },
      data: { role: originalRole },
    });
    await cleanupFixtures();
    await prisma.$disconnect();
  }

  finish();
}

main().catch(async (error) => {
  console.error("Suite crashed:", error);
  process.exitCode = 1;
  await prisma.$disconnect();
});
