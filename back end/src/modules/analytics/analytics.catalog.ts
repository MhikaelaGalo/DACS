import { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { HttpError } from "../../utils/httpError";

/*
 * Backend-driven field catalog for the dashboard's Create Visual
 * builder (the replacement for the frontend's removed sample table).
 *
 * Every dataset, dimension and measure below is an ALLOWLIST entry: the
 * frontend only ever sends catalog IDs, and each ID maps to a fixed SQL
 * fragment written here. User input is never interpolated into SQL —
 * an unknown ID is a 400, so the builder cannot be turned into an
 * arbitrary query interface.
 *
 * Deliberately excluded from every dataset: personal data (names,
 * emails, phone numbers, street addresses, Facebook handles), auth
 * identifiers (firebase_uid, user/customer IDs), file-storage paths,
 * free-text notes and raw JSON payloads. Geography is exposed at
 * region/province/municipality level only.
 */

export type DimensionKind = "category" | "date" | "geo";

export type Aggregation = "count" | "sum" | "avg" | "min" | "max";

export type MeasureFormat = "count" | "number" | "currency" | "percent";

export type DateBucket = "day" | "month" | "quarter" | "year";

interface DimensionDef {
  id: string;
  label: string;
  kind: DimensionKind;
  /* SELECT expression for category/geo; bare column for date (the
     query wraps it in date_trunc + to_char). */
  sql: Prisma.Sql;
  /* Date columns that may be NULL get an automatic IS NOT NULL guard. */
  nullable?: boolean;
  /*
   * True when the dimension yields raw database enum tokens
   * (PAYMENT_VERIFIED, PARENT_STOCK, ...). The frontend uses this to
   * title-case values for DISPLAY ONLY — grouping, filtering and the
   * API payload keep the raw values. Never set on free-text fields
   * (product names, module titles, sheet names), geography, dates, or
   * CASE expressions that already emit readable labels.
   */
  enumLike?: boolean;
}

interface MeasureDef {
  id: string;
  label: string;
  /* First entry is the builder's default. "count" measures have no
     column; numeric measures list only aggregations that make sense
     for the field (unit price sums, for example, are meaningless). */
  aggregations: readonly Aggregation[];
  sql?: Prisma.Sql;
  format: MeasureFormat;
}

interface DatasetDef {
  id: string;
  label: string;
  description: string;
  from: Prisma.Sql;
  baseWhere?: Prisma.Sql;
  dimensions: readonly DimensionDef[];
  measures: readonly MeasureDef[];
}

const RECORD_SOURCE_SQL = (column: Prisma.Sql) => Prisma.sql`
  CASE WHEN ${column}::text = 'HISTORICAL_IMPORT'
       THEN 'Historical import' ELSE 'Live' END`;

const COUNT_MEASURE = (id: string, label: string): MeasureDef => ({
  id,
  label,
  aggregations: ["count"],
  format: "count",
});

/*
 * The paid-status rule mirrors analytics.service.ts: an order counts as
 * a sale once payment is verified (or later in the lifecycle);
 * PENDING/APPROVED/PAYMENT_SUBMITTED orders are demand, not sales.
 */
const ORDER_STAGE_SQL = Prisma.sql`
  CASE
    WHEN o.status::text IN ('PAYMENT_VERIFIED','PROCESSING','SHIPPED','DELIVERED')
      THEN 'Sale (payment verified or later)'
    WHEN o.status::text IN ('PENDING','APPROVED','PAYMENT_SUBMITTED')
      THEN 'Demand (not yet paid)'
    ELSE 'Rejected / Cancelled'
  END`;

const DATASETS: readonly DatasetDef[] = [
  {
    id: "orders",
    label: "Orders",
    description: "Customer orders (live workflow and historical imports).",
    from: Prisma.sql`FROM orders o
      JOIN customer_profiles cp ON cp.id = o.customer_profile_id`,
    dimensions: [
      { id: "orderType", label: "Order Type", kind: "category", enumLike: true, sql: Prisma.sql`o.order_type::text` },
      { id: "status", label: "Order Status", kind: "category", enumLike: true, sql: Prisma.sql`o.status::text` },
      { id: "salesStage", label: "Order Stage (Demand vs Sale)", kind: "category", sql: ORDER_STAGE_SQL },
      { id: "fulfillmentMethod", label: "Fulfillment Method", kind: "category", enumLike: true, sql: Prisma.sql`COALESCE(o.fulfillment_method::text, 'Unspecified')` },
      { id: "source", label: "Record Source", kind: "category", sql: RECORD_SOURCE_SQL(Prisma.sql`o.source`) },
      { id: "customerRegion", label: "Customer Region", kind: "category", sql: Prisma.sql`COALESCE(cp.region, 'Unspecified')` },
      { id: "customerProvince", label: "Customer Province", kind: "geo", sql: Prisma.sql`COALESCE(cp.province, 'Unspecified')` },
      { id: "createdAt", label: "Order Date", kind: "date", sql: Prisma.sql`o.created_at` },
    ],
    measures: [
      COUNT_MEASURE("count", "Number of Orders"),
      {
        id: "totalAmount",
        label: "Order Amount (PHP)",
        aggregations: ["sum", "avg", "min", "max"],
        sql: Prisma.sql`o.total_amount`,
        format: "currency",
      },
    ],
  },
  {
    id: "order-items",
    label: "Order Items",
    description: "Individual product and seminar-module lines inside orders.",
    // LEFT JOIN: seminar-module access lines have no product row — they
    // must still count here, categorized as SEMINAR below.
    from: Prisma.sql`FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id`,
    dimensions: [
      { id: "product", label: "Product (as ordered)", kind: "category", sql: Prisma.sql`oi.product_name_snapshot` },
      { id: "productCategory", label: "Product Category", kind: "category", enumLike: true, sql: Prisma.sql`COALESCE(p.category::text, 'SEMINAR')` },
      { id: "orderType", label: "Order Type", kind: "category", enumLike: true, sql: Prisma.sql`o.order_type::text` },
      { id: "orderStatus", label: "Order Status", kind: "category", enumLike: true, sql: Prisma.sql`o.status::text` },
      { id: "orderStage", label: "Order Stage (Demand vs Sale)", kind: "category", sql: ORDER_STAGE_SQL },
      { id: "orderCreatedAt", label: "Order Date", kind: "date", sql: Prisma.sql`o.created_at` },
    ],
    measures: [
      COUNT_MEASURE("count", "Number of Line Items"),
      {
        id: "quantity",
        label: "Quantity Ordered",
        aggregations: ["sum", "avg", "min", "max"],
        sql: Prisma.sql`oi.quantity`,
        format: "number",
      },
      {
        id: "lineTotal",
        label: "Line Total (PHP)",
        aggregations: ["sum", "avg", "min", "max"],
        sql: Prisma.sql`oi.line_total`,
        format: "currency",
      },
    ],
  },
  {
    id: "payments",
    label: "Payments",
    description: "Payment submissions and their verification outcomes.",
    from: Prisma.sql`FROM payments pay`,
    dimensions: [
      { id: "status", label: "Payment Status", kind: "category", enumLike: true, sql: Prisma.sql`pay.status::text` },
      { id: "paymentType", label: "Payment Type", kind: "category", enumLike: true, sql: Prisma.sql`pay.payment_type::text` },
      { id: "source", label: "Record Source", kind: "category", sql: RECORD_SOURCE_SQL(Prisma.sql`pay.source`) },
      { id: "createdAt", label: "Recorded Date", kind: "date", sql: Prisma.sql`pay.created_at` },
      { id: "paymentDate", label: "Payment Date", kind: "date", sql: Prisma.sql`pay.payment_date`, nullable: true },
    ],
    measures: [
      COUNT_MEASURE("count", "Number of Payments"),
      {
        id: "amount",
        label: "Payment Amount (PHP)",
        aggregations: ["sum", "avg", "min", "max"],
        sql: Prisma.sql`pay.amount`,
        format: "currency",
      },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    description: "Active (non-archived) customer profiles.",
    from: Prisma.sql`FROM customer_profiles cp`,
    baseWhere: Prisma.sql`cp.archived_at IS NULL`,
    dimensions: [
      { id: "region", label: "Region", kind: "category", sql: Prisma.sql`COALESCE(cp.region, 'Unspecified')` },
      { id: "province", label: "Province", kind: "geo", sql: Prisma.sql`COALESCE(cp.province, 'Unspecified')` },
      { id: "cityMunicipality", label: "City / Municipality", kind: "category", sql: Prisma.sql`COALESCE(cp.city_municipality, 'Unspecified')` },
      { id: "accountLink", label: "Online Account", kind: "category", sql: Prisma.sql`CASE WHEN cp.user_id IS NULL THEN 'No online account' ELSE 'Has online account' END` },
      { id: "createdAt", label: "Registration Date", kind: "date", sql: Prisma.sql`cp.created_at` },
    ],
    measures: [COUNT_MEASURE("count", "Number of Customers")],
  },
  {
    id: "farms",
    label: "Farms",
    description: "Active (non-archived) customer farms.",
    from: Prisma.sql`FROM farms f`,
    baseWhere: Prisma.sql`f.archived_at IS NULL`,
    dimensions: [
      { id: "region", label: "Region", kind: "category", sql: Prisma.sql`COALESCE(f.region, 'Unspecified')` },
      { id: "province", label: "Province", kind: "geo", sql: Prisma.sql`COALESCE(f.province, 'Unspecified')` },
      { id: "designation", label: "Farm Designation", kind: "category", sql: Prisma.sql`CASE WHEN f.is_primary THEN 'Primary farm' ELSE 'Additional farm' END` },
      { id: "createdAt", label: "Date Added", kind: "date", sql: Prisma.sql`f.created_at` },
    ],
    measures: [COUNT_MEASURE("count", "Number of Farms")],
  },
  {
    id: "products",
    label: "Products",
    description: "The product catalog (Parent Stock, F1, veterinary products).",
    from: Prisma.sql`FROM products p`,
    dimensions: [
      { id: "name", label: "Product Name", kind: "category", sql: Prisma.sql`p.name` },
      { id: "category", label: "Product Category", kind: "category", enumLike: true, sql: Prisma.sql`p.category::text` },
      { id: "catalogStatus", label: "Catalog Status", kind: "category", sql: Prisma.sql`CASE WHEN p.is_active THEN 'Active' ELSE 'Inactive' END` },
    ],
    measures: [
      COUNT_MEASURE("count", "Number of Products"),
      {
        id: "unitPrice",
        label: "Unit Price (PHP)",
        aggregations: ["avg", "min", "max"],
        sql: Prisma.sql`p.unit_price`,
        format: "currency",
      },
    ],
  },
  {
    id: "seminar-enrollments",
    label: "Seminar Enrollments",
    description: "Farmer enrollments in e-learning seminar modules.",
    from: Prisma.sql`FROM seminar_enrollments se
      JOIN seminar_modules sm ON sm.id = se.module_id
      JOIN customer_profiles cp ON cp.id = se.customer_profile_id`,
    dimensions: [
      { id: "module", label: "Seminar Module", kind: "category", sql: Prisma.sql`sm.title` },
      { id: "completion", label: "Completion Status", kind: "category", sql: Prisma.sql`CASE WHEN se.completed_at IS NULL THEN 'In progress' ELSE 'Completed' END` },
      { id: "customerRegion", label: "Customer Region", kind: "category", sql: Prisma.sql`COALESCE(cp.region, 'Unspecified')` },
      { id: "startedAt", label: "Enrollment Date", kind: "date", sql: Prisma.sql`se.started_at` },
      { id: "completedAt", label: "Completion Date", kind: "date", sql: Prisma.sql`se.completed_at`, nullable: true },
    ],
    measures: [COUNT_MEASURE("count", "Number of Enrollments")],
  },
  {
    id: "quiz-attempts",
    label: "Quiz Attempts",
    description: "Seminar quiz attempts and scores.",
    from: Prisma.sql`FROM quiz_attempts qa
      JOIN seminar_enrollments se ON se.id = qa.enrollment_id
      JOIN seminar_modules sm ON sm.id = se.module_id`,
    dimensions: [
      { id: "module", label: "Seminar Module", kind: "category", sql: Prisma.sql`sm.title` },
      { id: "result", label: "Quiz Result", kind: "category", sql: Prisma.sql`CASE WHEN qa.passed THEN 'Passed' ELSE 'Failed' END` },
      { id: "createdAt", label: "Attempt Date", kind: "date", sql: Prisma.sql`qa.created_at` },
    ],
    measures: [
      COUNT_MEASURE("count", "Number of Attempts"),
      {
        id: "percentage",
        label: "Score (%)",
        aggregations: ["avg", "min", "max"],
        sql: Prisma.sql`qa.percentage`,
        format: "percent",
      },
    ],
  },
  {
    id: "certificate-requests",
    label: "Seminar Certificate Requests",
    description: "Requests for seminar certificates of attendance.",
    from: Prisma.sql`FROM certificate_requests cr`,
    dimensions: [
      { id: "status", label: "Request Status", kind: "category", enumLike: true, sql: Prisma.sql`cr.status::text` },
      { id: "requestedAt", label: "Request Date", kind: "date", sql: Prisma.sql`cr.requested_at` },
      { id: "certificateIssuedAt", label: "Issue Date", kind: "date", sql: Prisma.sql`cr.certificate_issued_at`, nullable: true },
    ],
    measures: [COUNT_MEASURE("count", "Number of Requests")],
  },
  {
    id: "breeder-monitoring",
    label: "Breeder Monitoring",
    description: "Parent Stock releases under the 90-day breeder monitoring cycle.",
    from: Prisma.sql`FROM breeder_monitoring bm
      LEFT JOIN breeder_eligibility be ON be.monitoring_id = bm.id
      JOIN farms f ON f.id = bm.farm_id`,
    dimensions: [
      { id: "eligibilityStatus", label: "Eligibility Status", kind: "category", enumLike: true, sql: Prisma.sql`COALESCE(be.status::text, 'PENDING')` },
      { id: "farmRegion", label: "Farm Region", kind: "category", sql: Prisma.sql`COALESCE(f.region, 'Unspecified')` },
      { id: "farmProvince", label: "Farm Province", kind: "geo", sql: Prisma.sql`COALESCE(f.province, 'Unspecified')` },
      { id: "releasedAt", label: "PS Release Date", kind: "date", sql: Prisma.sql`bm.released_at` },
      { id: "eligibleAt", label: "Eligibility Date", kind: "date", sql: Prisma.sql`bm.eligible_at` },
    ],
    measures: [COUNT_MEASURE("count", "Number of Monitoring Records")],
  },
  {
    id: "breeder-certifications",
    label: "Breeder Certifications",
    description: "Issued breeder certificates and their validity.",
    from: Prisma.sql`FROM breeder_certifications bc
      JOIN breeder_monitoring bm ON bm.id = bc.monitoring_id
      JOIN farms f ON f.id = bm.farm_id`,
    dimensions: [
      {
        id: "status",
        label: "Certification Status",
        kind: "category",
        enumLike: true,
        /* Date-aware like the registry rule: an ACTIVE certificate past
           its expiry date reports as EXPIRED even before the stored
           status refreshes. */
        sql: Prisma.sql`CASE WHEN bc.status::text = 'ACTIVE' AND bc.expires_at <= NOW() THEN 'EXPIRED' ELSE bc.status::text END`,
      },
      { id: "farmRegion", label: "Farm Region", kind: "category", sql: Prisma.sql`COALESCE(f.region, 'Unspecified')` },
      { id: "farmProvince", label: "Farm Province", kind: "geo", sql: Prisma.sql`COALESCE(f.province, 'Unspecified')` },
      { id: "certifiedAt", label: "Certification Date", kind: "date", sql: Prisma.sql`bc.certified_at` },
      { id: "expiresAt", label: "Expiry Date", kind: "date", sql: Prisma.sql`bc.expires_at` },
    ],
    measures: [COUNT_MEASURE("count", "Number of Certifications")],
  },
  {
    id: "inquiry-tickets",
    label: "Inquiry Tickets",
    description: "Customer inquiry tickets and their handling status.",
    from: Prisma.sql`FROM inquiry_tickets it`,
    dimensions: [
      { id: "status", label: "Ticket Status", kind: "category", enumLike: true, sql: Prisma.sql`it.status::text` },
      { id: "category", label: "Category", kind: "category", sql: Prisma.sql`COALESCE(it.category, 'Uncategorized')` },
      { id: "priority", label: "Priority", kind: "category", sql: Prisma.sql`COALESCE(it.priority, 'Unspecified')` },
      { id: "createdAt", label: "Ticket Date", kind: "date", sql: Prisma.sql`it.created_at` },
    ],
    measures: [COUNT_MEASURE("count", "Number of Tickets")],
  },
  {
    id: "historical-records",
    label: "Historical Source Records",
    description: "Lossless archive rows imported from legacy spreadsheets.",
    from: Prisma.sql`FROM historical_source_records hsr`,
    dimensions: [
      { id: "recordType", label: "Record Type", kind: "category", enumLike: true, sql: Prisma.sql`hsr.record_type::text` },
      { id: "validationStatus", label: "Validation Status", kind: "category", enumLike: true, sql: Prisma.sql`hsr.validation_status::text` },
      { id: "customerLink", label: "Customer Link", kind: "category", sql: Prisma.sql`CASE WHEN hsr.customer_profile_id IS NULL THEN 'Not linked' ELSE 'Linked to customer' END` },
      { id: "sourceSheet", label: "Source Sheet", kind: "category", sql: Prisma.sql`hsr.sheet_name` },
      { id: "registrationDate", label: "Legacy Registration Date", kind: "date", sql: Prisma.sql`hsr.registration_date`, nullable: true },
    ],
    measures: [COUNT_MEASURE("count", "Number of Records")],
  },
];

const DATASET_MAP = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));

export const DATE_BUCKETS: readonly DateBucket[] = [
  "day",
  "month",
  "quarter",
  "year",
];

/* to_char formats chosen so plain string sort = chronological sort. */
const BUCKET_FORMATS: Record<DateBucket, string> = {
  day: "YYYY-MM-DD",
  month: "YYYY-MM",
  quarter: 'YYYY-"Q"Q',
  year: "YYYY",
};

// ---- Public metadata (GET /api/analytics/fields) ---------------------------

export function getFieldCatalog() {
  return {
    generatedAt: new Date().toISOString(),
    dateBuckets: DATE_BUCKETS.map((bucket) => ({
      id: bucket,
      label: bucket.charAt(0).toUpperCase() + bucket.slice(1),
    })),
    datasets: DATASETS.map((dataset) => ({
      id: dataset.id,
      label: dataset.label,
      description: dataset.description,
      dimensions: dataset.dimensions.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        kind: dimension.kind,
        enumLike: dimension.enumLike ?? false,
      })),
      measures: dataset.measures.map((measure) => ({
        id: measure.id,
        label: measure.label,
        format: measure.format,
        aggregations: [...measure.aggregations],
      })),
    })),
  };
}

// ---- Query resolution ------------------------------------------------------

export interface AnalyticsQueryInput {
  dataset: string;
  xField?: string | null;
  xBucket?: string | null;
  yField: string;
  aggregation?: string | null;
  legendField?: string | null;
}

interface ResolvedQuery {
  dataset: DatasetDef;
  x: DimensionDef | null;
  xBucket: DateBucket | null;
  legend: DimensionDef | null;
  measure: MeasureDef;
  aggregation: Aggregation;
}

function resolveQuery(input: AnalyticsQueryInput): ResolvedQuery {
  const dataset = DATASET_MAP.get(input.dataset);
  if (!dataset) {
    throw new HttpError(
      400,
      "The data source is not a known analytics dataset.",
      "dataset"
    );
  }

  const findDimension = (id: string, field: string): DimensionDef => {
    const dimension = dataset.dimensions.find((entry) => entry.id === id);
    if (!dimension) {
      throw new HttpError(
        400,
        `"${id}" is not an available field of the ${dataset.label} data source.`,
        field
      );
    }
    return dimension;
  };

  const x = input.xField ? findDimension(input.xField, "xField") : null;
  const legend = input.legendField
    ? findDimension(input.legendField, "legendField")
    : null;

  if (legend && !x) {
    throw new HttpError(
      400,
      "A legend field requires an X-axis field.",
      "legendField"
    );
  }
  if (legend && x && legend.id === x.id) {
    throw new HttpError(
      400,
      "The legend field must differ from the X-axis field.",
      "legendField"
    );
  }
  if (legend && legend.kind === "date") {
    throw new HttpError(
      400,
      "Date fields cannot be used as the legend.",
      "legendField"
    );
  }

  let xBucket: DateBucket | null = null;
  if (x?.kind === "date") {
    const bucket = input.xBucket ?? "month";
    if (!DATE_BUCKETS.includes(bucket as DateBucket)) {
      throw new HttpError(
        400,
        "The date grouping must be day, month, quarter or year.",
        "xBucket"
      );
    }
    xBucket = bucket as DateBucket;
  } else if (input.xBucket) {
    throw new HttpError(
      400,
      "A date grouping only applies to date fields.",
      "xBucket"
    );
  }

  const measure = dataset.measures.find((entry) => entry.id === input.yField);
  if (!measure) {
    throw new HttpError(
      400,
      `"${input.yField}" is not an available measure of the ${dataset.label} data source.`,
      "yField"
    );
  }

  const aggregation = (input.aggregation ??
    measure.aggregations[0]) as Aggregation;
  if (!measure.aggregations.includes(aggregation)) {
    throw new HttpError(
      400,
      `The ${aggregation} aggregation is not available for ${measure.label}.`,
      "aggregation"
    );
  }

  return { dataset, x, xBucket, legend, measure, aggregation };
}

// ---- Query execution (GET /api/analytics/query) ----------------------------

/* Grouped results are inherently small; the cap only guards degenerate
   configurations (e.g. municipality × product). */
const GROUP_ROW_LIMIT = 400;

export interface AnalyticsQueryRow {
  x: string | null;
  legend: string | null;
  value: number | null;
}

function aggregationSql(
  measure: MeasureDef,
  aggregation: Aggregation
): Prisma.Sql {
  if (aggregation === "count" || !measure.sql) {
    return Prisma.sql`COUNT(*)::int`;
  }
  switch (aggregation) {
    case "sum":
      return Prisma.sql`COALESCE(SUM(${measure.sql}), 0)::float8`;
    case "avg":
      return Prisma.sql`AVG(${measure.sql})::float8`;
    case "min":
      return Prisma.sql`MIN(${measure.sql})::float8`;
    case "max":
      return Prisma.sql`MAX(${measure.sql})::float8`;
  }
}

function dimensionSelectSql(
  dimension: DimensionDef,
  bucket: DateBucket | null
): Prisma.Sql {
  if (dimension.kind === "date") {
    const format = BUCKET_FORMATS[bucket ?? "month"];
    return Prisma.sql`to_char(date_trunc(${bucket ?? "month"}, ${dimension.sql}), ${format})`;
  }
  return dimension.sql;
}

export async function runAnalyticsQuery(input: AnalyticsQueryInput) {
  const resolved = resolveQuery(input);
  const { dataset, x, xBucket, legend, measure, aggregation } = resolved;

  const valueSql = aggregationSql(measure, aggregation);

  const conditions: Prisma.Sql[] = [];
  if (dataset.baseWhere) conditions.push(dataset.baseWhere);
  if (x?.kind === "date" && x.nullable) {
    conditions.push(Prisma.sql`${x.sql} IS NOT NULL`);
  }
  const whereSql = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
    : Prisma.empty;

  let rows: AnalyticsQueryRow[];

  if (!x) {
    /* KPI-style single value. */
    const result = await prisma.$queryRaw<Array<{ value: number | null }>>(
      Prisma.sql`SELECT ${valueSql} AS value ${dataset.from} ${whereSql}`
    );
    rows = [{ x: null, legend: null, value: result[0]?.value ?? null }];
  } else if (!legend) {
    const orderSql =
      x.kind === "date"
        ? Prisma.sql`ORDER BY 1 ASC`
        : Prisma.sql`ORDER BY 2 DESC, 1 ASC`;
    const result = await prisma.$queryRaw<
      Array<{ x: string | null; value: number | null }>
    >(
      Prisma.sql`SELECT ${dimensionSelectSql(x, xBucket)} AS x, ${valueSql} AS value
        ${dataset.from} ${whereSql}
        GROUP BY 1 ${orderSql}
        LIMIT ${GROUP_ROW_LIMIT}`
    );
    rows = result.map((row) => ({ x: row.x, legend: null, value: row.value }));
  } else {
    const result = await prisma.$queryRaw<
      Array<{ x: string | null; legend: string | null; value: number | null }>
    >(
      Prisma.sql`SELECT ${dimensionSelectSql(x, xBucket)} AS x, ${legend.sql} AS legend, ${valueSql} AS value
        ${dataset.from} ${whereSql}
        GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC
        LIMIT ${GROUP_ROW_LIMIT}`
    );
    rows = result;
  }

  return {
    generatedAt: new Date().toISOString(),
    dataset: dataset.id,
    x: x
      ? {
          field: x.id,
          label: x.label,
          kind: x.kind,
          bucket: xBucket,
          enumLike: x.enumLike ?? false,
        }
      : null,
    legend: legend
      ? {
          field: legend.id,
          label: legend.label,
          kind: legend.kind,
          enumLike: legend.enumLike ?? false,
        }
      : null,
    measure: {
      field: measure.id,
      label: measure.label,
      format: measure.format,
      aggregation,
    },
    rows,
    truncated: rows.length === GROUP_ROW_LIMIT,
  };
}

// ---- Visual-configuration validation (dashboard module) --------------------

/*
 * Per-chart-type field requirements, enforced when a custom visual is
 * created or updated so nothing unrenderable (or catalog-unknown) is
 * ever persisted. Built-in visuals bypass this — they render from the
 * frontend's fixed chart registry and carry no field picks.
 */
export interface CustomVisualConfig {
  visualType: string;
  dataset: string | null;
  xField: string | null;
  xBucket: string | null;
  yField: string | null;
  aggregation: string | null;
  legendField: string | null;
}

export interface NormalizedVisualConfig {
  dataset: string;
  xField: string | null;
  xBucket: string | null;
  yField: string;
  aggregation: string;
  legendField: string | null;
}

export function validateCustomVisualConfig(
  config: CustomVisualConfig
): NormalizedVisualConfig {
  if (!config.dataset) {
    throw new HttpError(
      400,
      "Choose a data source: custom visuals are built from backend analytics fields.",
      "dataset"
    );
  }
  if (!config.yField) {
    throw new HttpError(
      400,
      "This visual type needs a value (Y-axis) field.",
      "yField"
    );
  }

  const isKpi = config.visualType === "kpi";
  const isMap = config.visualType === "filled-map";
  const isHeatmap = config.visualType === "heatmap";
  const isPie = config.visualType === "pie" || config.visualType === "donut";

  if (isKpi) {
    if (config.xField || config.legendField) {
      throw new HttpError(
        400,
        "A KPI takes only a measure — no X-axis or legend field.",
        config.xField ? "xField" : "legendField"
      );
    }
  } else if (!config.xField) {
    throw new HttpError(
      400,
      "This visual type needs an X-axis (category) field.",
      "xField"
    );
  }

  if ((isMap || isPie) && config.legendField) {
    throw new HttpError(
      400,
      isMap
        ? "A filled map takes only a location field and a measure."
        : "Pie and donut charts use the X-axis field for their slices — no legend field.",
      "legendField"
    );
  }

  if (isHeatmap && !config.legendField) {
    throw new HttpError(
      400,
      "A heatmap needs a legend (column) field in addition to the X-axis.",
      "legendField"
    );
  }

  /* Membership + aggregation + bucket checks, shared with /query. */
  const resolved = resolveQuery({
    dataset: config.dataset,
    xField: config.xField,
    xBucket: config.xBucket,
    yField: config.yField,
    aggregation: config.aggregation,
    legendField: config.legendField,
  });

  if (isMap && resolved.x?.kind !== "geo") {
    throw new HttpError(
      400,
      "A filled map needs a province (geographic) field as its location.",
      "xField"
    );
  }

  return {
    dataset: resolved.dataset.id,
    xField: resolved.x?.id ?? null,
    xBucket: resolved.xBucket,
    yField: resolved.measure.id,
    aggregation: resolved.aggregation,
    legendField: resolved.legend?.id ?? null,
  };
}
