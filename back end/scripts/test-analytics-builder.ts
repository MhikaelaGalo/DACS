/**
 * DACS backend-driven Create Visual test (2026-08-23 milestone).
 *
 * Run with the TEST server started (npm run dev:test), then:
 *   npx tsx --env-file=.env.test scripts/test-analytics-builder.ts
 * (or npm run test:analytics)
 *
 * Covers the analytics field catalog + query endpoints that replaced
 * the frontend's sample table (BUILDER_ROWS):
 *   - GET /api/analytics/fields  (catalog shape, sensitive-field audit)
 *   - GET /api/analytics/query   (values verified against direct
 *     Prisma/SQL aggregates over the same test database)
 *   - allowlist validation (unknown datasets/fields/aggregations,
 *     per-chart-type rules on visual create)
 *   - dashboard-visual persistence of the new catalog fields, and the
 *     rejection of legacy sample-data fields ("Month", "Sales (PHP)")
 *   - RBAC: farmers get nothing, IT staff get layouts but no analytics
 *
 * Hermetic: ANL-* fixtures (products, customers, orders, payments,
 * tickets, certificate requests) cleaned at start and end; the test
 * user's role is restored afterwards.
 */
import { assertTestServer } from "./lib/test-env";

import { readFileSync } from "node:fs";

import { applicationDefault } from "firebase-admin/app";

import { prisma } from "../src/config/database";
import { firebaseAuth } from "../src/config/firebase";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:5000";

const P = "ANL-"; // fixture prefix

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

function queryPath(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return `/api/analytics/query?${search.toString()}`;
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

async function cleanupFixtures(testUserId: string | null): Promise<void> {
  await prisma.payment.deleteMany({
    where: { order: { orderNumber: { startsWith: P } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: P } } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: P } },
  });
  await prisma.inquiryTicket.deleteMany({
    where: { ticketNumber: { startsWith: P } },
  });
  await prisma.certificateRequest.deleteMany({
    where: { customerProfile: { customerNumber: { startsWith: P } } },
  });
  await prisma.customerProfile.deleteMany({
    where: { customerNumber: { startsWith: P } },
  });
  await prisma.product.deleteMany({
    where: { productCode: { startsWith: P } },
  });
  if (testUserId) {
    await prisma.dashboardVisual.deleteMany({
      where: { userId: testUserId, title: { startsWith: "ANL " } },
    });
  }
}

async function setRole(
  userId: string,
  role: "OWNER_EXECUTIVE" | "ADMINISTRATIVE_STAFF" | "CLIENT_FARMER" | "IT_STAFF"
) {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

async function seedFixtures() {
  const psProduct = await prisma.product.create({
    data: {
      productCode: `${P}PS-001`,
      name: "ANL Test Parent Stock",
      category: "PARENT_STOCK",
      unitPrice: 1500,
    },
  });
  const vetProduct = await prisma.product.create({
    data: {
      productCode: `${P}VET-001`,
      name: "ANL Test Vet Product",
      category: "VETERINARY_PRODUCT",
      unitPrice: 250,
    },
  });

  const [c1, c2, c3] = await Promise.all(
    [
      { n: "0001", province: "Bulacan", region: "Region III" },
      { n: "0002", province: "Bulacan", region: "Region III" },
      { n: "0003", province: "Batangas", region: "Region IV-A" },
    ].map((row) =>
      prisma.customerProfile.create({
        data: {
          customerNumber: `${P}CUST-${row.n}`,
          firstName: "Analytics",
          lastName: `Fixture${row.n}`,
          province: row.province,
          region: row.region,
        },
      })
    )
  );

  /* Mid-month timestamps so month buckets are timezone-stable. */
  const orders = [
    { n: "0001", customer: c1, type: "PARENT_STOCK", status: "DELIVERED", total: 3000, at: "2026-06-10T08:00:00.000Z", product: psProduct, qty: 2 },
    { n: "0002", customer: c2, type: "PARENT_STOCK", status: "PENDING", total: 1500, at: "2026-07-05T08:00:00.000Z", product: psProduct, qty: 1 },
    { n: "0003", customer: c3, type: "VETERINARY_PRODUCT", status: "PAYMENT_VERIFIED", total: 500, at: "2026-07-20T08:00:00.000Z", product: vetProduct, qty: 2 },
    { n: "0004", customer: c1, type: "VETERINARY_PRODUCT", status: "REJECTED", total: 250, at: "2026-06-15T08:00:00.000Z", product: vetProduct, qty: 1 },
  ] as const;

  const created = [];
  for (const row of orders) {
    created.push(
      await prisma.order.create({
        data: {
          orderNumber: `${P}ORD-${row.n}`,
          customerProfileId: row.customer.id,
          orderType: row.type,
          status: row.status,
          subtotal: row.total,
          totalAmount: row.total,
          createdAt: new Date(row.at),
          items: {
            create: {
              productId: row.product.id,
              productCodeSnapshot: row.product.productCode,
              productNameSnapshot: row.product.name,
              unitPriceSnapshot: row.product.unitPrice,
              quantity: row.qty,
              lineTotal: Number(row.product.unitPrice) * row.qty,
            },
          },
        },
      })
    );
  }

  await prisma.payment.create({
    data: {
      orderId: created[0].id,
      customerProfileId: c1.id,
      paymentType: "FULL",
      amount: 3000,
      status: "VERIFIED",
    },
  });
  await prisma.payment.create({
    data: {
      orderId: created[2].id,
      customerProfileId: c3.id,
      paymentType: "DEPOSIT",
      amount: 250,
      status: "SUBMITTED",
    },
  });

  await prisma.inquiryTicket.create({
    data: {
      ticketNumber: `${P}TKT-0001`,
      customerProfileId: c1.id,
      subject: "Analytics fixture ticket",
      message: "open",
      category: "Orders",
    },
  });
  await prisma.inquiryTicket.create({
    data: {
      ticketNumber: `${P}TKT-0002`,
      customerProfileId: c2.id,
      subject: "Analytics fixture ticket",
      message: "closed",
      category: "Orders",
      status: "CLOSED",
      closedAt: new Date(),
    },
  });

  await prisma.certificateRequest.create({
    data: {
      customerProfileId: c1.id,
      status: "APPROVED",
      certificateNumber: `${P}CERT-0001`,
      certificateIssuedAt: new Date(),
    },
  });
  await prisma.certificateRequest.create({
    data: { customerProfileId: c2.id, status: "PENDING" },
  });
}

const PAID_STATUSES = [
  "PAYMENT_VERIFIED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const;

async function main(): Promise<void> {
  console.log(`\nDACS analytics-builder test against ${BASE_URL}\n`);
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

  try {
    await cleanupFixtures(dacsUser.id);
    await seedFixtures();
    record("Seed ANL-* fixtures", true);

    // ---- A. RBAC ------------------------------------------------------------
    await setRole(dacsUser.id, "CLIENT_FARMER");
    const farmerFields = await api("/api/analytics/fields", { token });
    record("A: farmer GET /fields -> 403", farmerFields.status === 403, `status=${farmerFields.status}`);
    const farmerQuery = await api(
      queryPath({ dataset: "orders", xField: "orderType", yField: "count" }),
      { token }
    );
    record("A: farmer GET /query -> 403", farmerQuery.status === 403, `status=${farmerQuery.status}`);

    await setRole(dacsUser.id, "IT_STAFF");
    const itFields = await api("/api/analytics/fields", { token });
    const itVisuals = await api("/api/dashboard/visuals", { token });
    record(
      "A: IT staff -> no analytics fields (403) but own layout (200)",
      itFields.status === 403 && itVisuals.status === 200,
      `fields=${itFields.status} visuals=${itVisuals.status}`
    );

    await setRole(dacsUser.id, "ADMINISTRATIVE_STAFF");

    // ---- B. Field catalog ---------------------------------------------------
    const fields = await api("/api/analytics/fields", { token });
    const datasets: any[] = fields.body?.data?.datasets ?? [];
    const datasetIds = datasets.map((entry) => entry.id);
    record(
      "B: GET /fields lists the expected datasets",
      fields.status === 200 &&
        [
          "orders",
          "order-items",
          "payments",
          "customers",
          "farms",
          "products",
          "seminar-enrollments",
          "quiz-attempts",
          "certificate-requests",
          "breeder-monitoring",
          "breeder-certifications",
          "inquiry-tickets",
          "historical-records",
        ].every((id) => datasetIds.includes(id)),
      datasetIds.join(",")
    );

    const ordersDataset = datasets.find((entry) => entry.id === "orders");
    record(
      "B: orders dataset has orderType dimension + count/totalAmount measures",
      Boolean(
        ordersDataset?.dimensions?.some((d: any) => d.id === "orderType") &&
          ordersDataset?.measures?.some((m: any) => m.id === "count") &&
          ordersDataset?.measures?.some(
            (m: any) =>
              m.id === "totalAmount" &&
              ["sum", "avg", "min", "max"].every((a) =>
                m.aggregations.includes(a)
              )
          )
      )
    );

    const productsDataset = datasets.find((entry) => entry.id === "products");
    const unitPrice = productsDataset?.measures?.find(
      (m: any) => m.id === "unitPrice"
    );
    record(
      "B: unit price offers avg/min/max but never sum",
      Boolean(unitPrice) &&
        !unitPrice.aggregations.includes("sum") &&
        unitPrice.aggregations.includes("avg")
    );

    /*
     * enumLike marks dimensions whose values are raw database enums so
     * the frontend title-cases them for DISPLAY ONLY. Free-text fields
     * (product names) must never carry it — that is what protects
     * codes/names from being reformatted.
     */
    const dimension = (datasetId: string, dimensionId: string) =>
      datasets
        .find((entry) => entry.id === datasetId)
        ?.dimensions?.find((d: any) => d.id === dimensionId);
    record(
      "B: enumLike marks enum dimensions, never free text / geo / dates",
      dimension("orders", "status")?.enumLike === true &&
        dimension("orders", "orderType")?.enumLike === true &&
        dimension("inquiry-tickets", "status")?.enumLike === true &&
        dimension("order-items", "product")?.enumLike === false &&
        dimension("products", "name")?.enumLike === false &&
        dimension("customers", "province")?.enumLike === false &&
        dimension("orders", "createdAt")?.enumLike === false,
      `orders.status=${dimension("orders", "status")?.enumLike} product=${dimension("order-items", "product")?.enumLike}`
    );

    const catalogJson = JSON.stringify(fields.body?.data ?? {}).toLowerCase();
    const leaked = [
      "email",
      "phone",
      "firebase",
      "password",
      "token",
      "storageurl",
      "facebook",
      "firstname",
      "lastname",
    ].filter((term) => catalogJson.includes(term));
    record(
      "B: catalog exposes no sensitive/PII fields",
      leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(",")}` : ""
    );

    // ---- C. Query values vs direct database aggregates ----------------------
    const byType = await api(
      queryPath({ dataset: "orders", xField: "orderType", yField: "count" }),
      { token }
    );
    const psCount = await prisma.order.count({
      where: { orderType: "PARENT_STOCK" },
    });
    const vetCount = await prisma.order.count({
      where: { orderType: "VETERINARY_PRODUCT" },
    });
    const rowValue = (body: any, x: string) =>
      body?.data?.rows?.find((row: any) => row.x === x)?.value;
    record(
      "C: orders by type matches prisma.order.count",
      byType.status === 200 &&
        rowValue(byType.body, "PARENT_STOCK") === psCount &&
        rowValue(byType.body, "VETERINARY_PRODUCT") === vetCount,
      `api PS=${rowValue(byType.body, "PARENT_STOCK")} db PS=${psCount}, api VET=${rowValue(byType.body, "VETERINARY_PRODUCT")} db VET=${vetCount}`
    );

    record(
      "C: query rows keep RAW enum values; x metadata carries enumLike",
      byType.body?.data?.rows?.every((row: any) =>
        ["PARENT_STOCK", "F1", "VETERINARY_PRODUCT"].includes(row.x)
      ) && byType.body?.data?.x?.enumLike === true,
      `x.enumLike=${byType.body?.data?.x?.enumLike}`
    );

    const byStatus = await api(
      queryPath({ dataset: "orders", xField: "status", yField: "count" }),
      { token }
    );
    const statusGroups = await prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const statusesMatch =
      byStatus.status === 200 &&
      byStatus.body.data.rows.length === statusGroups.length &&
      statusGroups.every(
        (group) => rowValue(byStatus.body, group.status) === group._count._all
      );
    record(
      "C: orders by status matches prisma groupBy (every group, no extras)",
      statusesMatch,
      `api rows=${byStatus.body?.data?.rows?.length} db groups=${statusGroups.length}`
    );

    const perMonth = await api(
      queryPath({
        dataset: "orders",
        xField: "createdAt",
        xBucket: "month",
        yField: "count",
      }),
      { token }
    );
    const june = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c FROM orders
      WHERE to_char(date_trunc('month', created_at), 'YYYY-MM') = '2026-06'`;
    record(
      "C: orders per month (2026-06) matches direct SQL count",
      perMonth.status === 200 &&
        rowValue(perMonth.body, "2026-06") === june[0].c,
      `api=${rowValue(perMonth.body, "2026-06")} db=${june[0].c}`
    );

    const amountByType = await api(
      queryPath({
        dataset: "orders",
        xField: "orderType",
        yField: "totalAmount",
        aggregation: "sum",
      }),
      { token }
    );
    const psSum = await prisma.order.aggregate({
      where: { orderType: "PARENT_STOCK" },
      _sum: { totalAmount: true },
    });
    const apiPsSum = rowValue(amountByType.body, "PARENT_STOCK");
    record(
      "C: order amount sum by type matches prisma aggregate",
      amountByType.status === 200 &&
        Math.abs(Number(apiPsSum) - Number(psSum._sum.totalAmount ?? 0)) < 0.005,
      `api=${apiPsSum} db=${psSum._sum.totalAmount}`
    );

    const byProvince = await api(
      queryPath({ dataset: "customers", xField: "province", yField: "count" }),
      { token }
    );
    const bulacan = await prisma.customerProfile.count({
      where: { archivedAt: null, province: "Bulacan" },
    });
    record(
      "C: customers by province matches prisma count (active only)",
      byProvince.status === 200 &&
        rowValue(byProvince.body, "Bulacan") === bulacan,
      `api=${rowValue(byProvince.body, "Bulacan")} db=${bulacan}`
    );

    const quantityByProduct = await api(
      queryPath({
        dataset: "order-items",
        xField: "product",
        yField: "quantity",
        aggregation: "sum",
      }),
      { token }
    );
    const psQuantity = await prisma.orderItem.aggregate({
      where: { productNameSnapshot: "ANL Test Parent Stock" },
      _sum: { quantity: true },
    });
    record(
      "C: order-item quantity by product matches prisma aggregate (join handled server-side)",
      quantityByProduct.status === 200 &&
        rowValue(quantityByProduct.body, "ANL Test Parent Stock") ===
          Number(psQuantity._sum.quantity ?? 0),
      `api=${rowValue(quantityByProduct.body, "ANL Test Parent Stock")} db=${psQuantity._sum.quantity}`
    );

    const paymentsByStatus = await api(
      queryPath({
        dataset: "payments",
        xField: "status",
        yField: "amount",
        aggregation: "sum",
      }),
      { token }
    );
    const verifiedSum = await prisma.payment.aggregate({
      where: { status: "VERIFIED" },
      _sum: { amount: true },
    });
    record(
      "C: verified payment amount matches prisma aggregate",
      paymentsByStatus.status === 200 &&
        Math.abs(
          Number(rowValue(paymentsByStatus.body, "VERIFIED")) -
            Number(verifiedSum._sum.amount ?? 0)
        ) < 0.005,
      `api=${rowValue(paymentsByStatus.body, "VERIFIED")} db=${verifiedSum._sum.amount}`
    );

    const ticketsByStatus = await api(
      queryPath({ dataset: "inquiry-tickets", xField: "status", yField: "count" }),
      { token }
    );
    const submittedTickets = await prisma.inquiryTicket.count({
      where: { status: "SUBMITTED" },
    });
    record(
      "C: inquiry tickets by status matches prisma count",
      ticketsByStatus.status === 200 &&
        rowValue(ticketsByStatus.body, "SUBMITTED") === submittedTickets,
      `api=${rowValue(ticketsByStatus.body, "SUBMITTED")} db=${submittedTickets}`
    );

    const certificateKpi = await api(
      queryPath({ dataset: "certificate-requests", yField: "count" }),
      { token }
    );
    const certificateCount = await prisma.certificateRequest.count();
    record(
      "C: certificate-request KPI (no X) matches prisma count",
      certificateKpi.status === 200 &&
        certificateKpi.body?.data?.rows?.[0]?.value === certificateCount,
      `api=${certificateKpi.body?.data?.rows?.[0]?.value} db=${certificateCount}`
    );

    const withLegend = await api(
      queryPath({
        dataset: "orders",
        xField: "orderType",
        yField: "count",
        legendField: "salesStage",
      }),
      { token }
    );
    const paidPs = await prisma.order.count({
      where: { orderType: "PARENT_STOCK", status: { in: [...PAID_STATUSES] } },
    });
    const legendRow = withLegend.body?.data?.rows?.find(
      (row: any) =>
        row.x === "PARENT_STOCK" &&
        row.legend === "Sale (payment verified or later)"
    );
    const legendTotal = (withLegend.body?.data?.rows ?? []).reduce(
      (sum: number, row: any) => sum + (row.value ?? 0),
      0
    );
    const allOrders = await prisma.order.count();
    record(
      "C: legend query splits demand vs sale correctly and sums to all orders",
      withLegend.status === 200 &&
        legendRow?.value === paidPs &&
        legendTotal === allOrders,
      `paid PS api=${legendRow?.value} db=${paidPs}; total api=${legendTotal} db=${allOrders}`
    );

    const perYear = await api(
      queryPath({
        dataset: "orders",
        xField: "createdAt",
        xBucket: "year",
        yField: "count",
      }),
      { token }
    );
    const year2026 = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c FROM orders
      WHERE to_char(date_trunc('year', created_at), 'YYYY') = '2026'`;
    record(
      "C: year bucketing matches direct SQL count",
      perYear.status === 200 && rowValue(perYear.body, "2026") === year2026[0].c,
      `api=${rowValue(perYear.body, "2026")} db=${year2026[0].c}`
    );

    const avgPayment = await api(
      queryPath({ dataset: "payments", yField: "amount", aggregation: "avg" }),
      { token }
    );
    const dbAvg = await prisma.payment.aggregate({ _avg: { amount: true } });
    record(
      "C: average aggregation matches prisma _avg",
      avgPayment.status === 200 &&
        Math.abs(
          Number(avgPayment.body?.data?.rows?.[0]?.value ?? 0) -
            Number(dbAvg._avg.amount ?? 0)
        ) < 0.005,
      `api=${avgPayment.body?.data?.rows?.[0]?.value} db=${dbAvg._avg.amount}`
    );

    // ---- D. Allowlist validation -------------------------------------------
    const badDataset = await api(
      queryPath({ dataset: "users", xField: "role", yField: "count" }),
      { token }
    );
    record("D: unknown dataset -> 400", badDataset.status === 400, `status=${badDataset.status}`);

    const badField = await api(
      queryPath({ dataset: "orders", xField: "Month", yField: "count" }),
      { token }
    );
    record(
      "D: legacy sample field (Month) -> 400",
      badField.status === 400,
      `status=${badField.status}`
    );

    const badMeasure = await api(
      queryPath({ dataset: "orders", xField: "orderType", yField: "Sales (PHP)" }),
      { token }
    );
    record(
      'D: legacy sample measure ("Sales (PHP)") -> 400',
      badMeasure.status === 400,
      `status=${badMeasure.status}`
    );

    const badAggregation = await api(
      queryPath({
        dataset: "products",
        xField: "category",
        yField: "unitPrice",
        aggregation: "sum",
      }),
      { token }
    );
    record(
      "D: disallowed aggregation (sum of unit price) -> 400",
      badAggregation.status === 400,
      `status=${badAggregation.status}`
    );

    const badBucket = await api(
      queryPath({
        dataset: "orders",
        xField: "orderType",
        xBucket: "month",
        yField: "count",
      }),
      { token }
    );
    record(
      "D: date bucket on a category field -> 400",
      badBucket.status === 400,
      `status=${badBucket.status}`
    );

    const legendSameAsX = await api(
      queryPath({
        dataset: "orders",
        xField: "orderType",
        yField: "count",
        legendField: "orderType",
      }),
      { token }
    );
    record(
      "D: legend equal to X -> 400",
      legendSameAsX.status === 400,
      `status=${legendSameAsX.status}`
    );

    const dateLegend = await api(
      queryPath({
        dataset: "orders",
        xField: "orderType",
        yField: "count",
        legendField: "createdAt",
      }),
      { token }
    );
    record("D: date field as legend -> 400", dateLegend.status === 400, `status=${dateLegend.status}`);

    // ---- E. Visual persistence with catalog fields --------------------------
    const createVisual = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "clustered-column",
        title: "ANL Orders per month",
        dataset: "orders",
        xField: "createdAt",
        xBucket: "month",
        yField: "totalAmount",
      },
    });
    record(
      "E: create visual with catalog fields -> 201, aggregation defaulted to sum",
      createVisual.status === 201 &&
        createVisual.body?.data?.dataset === "orders" &&
        createVisual.body?.data?.aggregation === "sum" &&
        createVisual.body?.data?.xBucket === "month",
      `status=${createVisual.status} agg=${createVisual.body?.data?.aggregation}`
    );

    const legacyCreate = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "clustered-column",
        title: "ANL legacy sample visual",
        xField: "Month",
        yField: "Sales (PHP)",
      },
    });
    record(
      "E: legacy sample-data fields on create -> 400 (no dataset)",
      legacyCreate.status === 400,
      `status=${legacyCreate.status}`
    );

    const kpiWithX = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "kpi",
        title: "ANL bad KPI",
        dataset: "orders",
        xField: "orderType",
        yField: "count",
      },
    });
    record("E: KPI with an X field -> 400", kpiWithX.status === 400, `status=${kpiWithX.status}`);

    const heatmapNoLegend = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "heatmap",
        title: "ANL bad heatmap",
        dataset: "orders",
        xField: "orderType",
        yField: "count",
      },
    });
    record(
      "E: heatmap without legend -> 400",
      heatmapNoLegend.status === 400,
      `status=${heatmapNoLegend.status}`
    );

    const mapNonGeo = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "filled-map",
        title: "ANL bad map",
        dataset: "orders",
        xField: "status",
        yField: "count",
      },
    });
    record(
      "E: filled map with a non-geographic X -> 400",
      mapNonGeo.status === 400,
      `status=${mapNonGeo.status}`
    );

    const mapGeo = await api("/api/dashboard/visuals", {
      method: "POST",
      token,
      body: {
        visualType: "filled-map",
        title: "ANL customers map",
        dataset: "customers",
        xField: "province",
        yField: "count",
      },
    });
    record(
      "E: filled map with a province field -> 201",
      mapGeo.status === 201,
      `status=${mapGeo.status}`
    );

    /*
     * A pre-migration sample-data visual (dataset NULL) must surface
     * as-is so the frontend can show its honest obsolete state — and
     * its fields must be unusable for numbers via /query.
     */
    const legacyRow = await prisma.dashboardVisual.create({
      data: {
        userId: dacsUser.id,
        visualType: "clustered-column",
        title: "ANL legacy row",
        xField: "Month",
        yField: "Sales (PHP)",
        displayOrder: 99,
      },
    });
    const listVisuals = await api("/api/dashboard/visuals", { token });
    const legacyListed = (listVisuals.body?.data ?? []).find(
      (visual: any) => visual.id === legacyRow.id
    );
    record(
      "E: legacy visual is listed with dataset=null (frontend shows obsolete state)",
      Boolean(legacyListed) && legacyListed.dataset === null,
      `dataset=${String(legacyListed?.dataset)}`
    );

    // ---- F. No-fabrication guarantee ---------------------------------------
    const provinceRows = byProvince.body?.data?.rows ?? [];
    const provinceGroups = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(DISTINCT COALESCE(province, 'Unspecified'))::int AS c
      FROM customer_profiles WHERE archived_at IS NULL`;
    record(
      "F: row count equals real group count — no invented categories",
      provinceRows.length === provinceGroups[0].c,
      `api=${provinceRows.length} db=${provinceGroups[0].c}`
    );
  } finally {
    await cleanupFixtures(dacsUser.id);
    await setRole(dacsUser.id, originalRole);
    await prisma.$disconnect();
  }

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
