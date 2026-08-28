/*
 * These types mirror the DACS backend's real JSON responses field for
 * field (see back end/src/modules/...). Keeping the shapes identical is
 * what makes the later integration a service-internals swap.
 */

export type OrderStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_VERIFIED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export type OrderType = "PARENT_STOCK" | "F1" | "VETERINARY_PRODUCT" | "SEMINAR";

/* GET /api/analytics/dashboard -> data */
export interface DashboardSummary {
  generatedAt: string;
  kpis: {
    totalCustomers: number;
    totalFarms: number;
    totalOrders: number;
    paidRevenue: number;
    salesByType: Array<{ orderType: OrderType; sales: number; revenue: number }>;
    activeBreeders: number;
    openTickets: number;
    seminarCertificatesIssued: number;
  };
  charts: {
    salesPerMonth: Array<{
      month: string;
      orders: number;
      paidOrders: number;
      revenue: number;
    }>;
    ordersByStatus: Array<{ status: OrderStatus; count: number }>;
    ordersByType: Array<{ orderType: OrderType; orders: number; orderedAmount: number }>;
    paymentStatus: Array<{ status: string; count: number; amount: number }>;
    seminarByModule: Array<{
      moduleNumber: number;
      title: string;
      enrolled: number;
      completed: number;
      completionRate: number;
    }>;
    breederStatus: Array<{ status: string; count: number }>;
    breedersByRegion: Array<{
      region: string;
      province: string;
      total: number;
      active: number;
      pending: number;
      expired: number;
      ineligible: number;
    }>;
    customersByRegion: Array<{ region: string; count: number }>;
    inquiryStatus: Array<{ status: string; count: number }>;
    inquiriesPerMonth: Array<{ month: string; tickets: number }>;
  };
}

/* Quotation line items per order type (mockups OCQ-1..4). */
export interface VetLineItem {
  /* Backend product id — required to save item edits. */
  productId?: string;
  product: string;
  quantity: number;
  unit: string;
  price: number;
}

export interface F1LineItem {
  /* Backend product id — required to save item edits. */
  productId?: string;
  product: string;
  quantity: number;
  priceMin: number;
  priceMax: number;
  /* The unit price agreed for this order (within the range). */
  unitPrice: number;
}

export interface PsLineItem {
  /* Backend product id — required to save item edits. */
  productId?: string;
  product: string;
  sets: number;
  qtyF: number;
  upF: number;
  qtyM: number;
  upM: number;
  qtyAddM: number;
  upAddM: number;
  amtF: number;
  amtM: number;
}

/* Seminar-module access line (SEMINAR orders): fixed quantity 1, priced
   at the module's checkout-time snapshot. Never editable by staff. */
export interface SeminarLineItem {
  seminarModuleId: string | null;
  module: string;
  quantity: number;
  price: number;
}

/* GET /api/orders (staff) -> data[n], flattened for the queue table */
export interface OrderQueueRow {
  id: string;
  orderNumber: string;
  customerNumber: string;
  customerName: string;
  /* Customer email + product names feed the queue search. */
  email: string;
  productSummary: string;
  /* HISTORICAL_IMPORT rows were migrated from legacy spreadsheets. */
  source: "LIVE" | "HISTORICAL_IMPORT";
  orderType: OrderType;
  quantity: number;
  totalAmount: number;
  dateNeeded: string | null;
  hatchDate: string | null;
  status: OrderStatus;
  receiverName: string | null;
  receiverFacebook: string | null;
  receiverContact: string | null;
  fulfillmentMethod: "PICKUP" | "LBC_BRANCH" | "AIRPORT" | "DELIVERY" | null;
  deliveryAddress: string | null;
  airportLocation: string | null;
  pickupBranch: string | null;
  instructions: string | null;
  feeTotal: number;
  paymentDate: string | null;
  /* Quotation header extras (per order type). */
  farmName: string | null;
  oqDate: string | null;
  depositPercent: number | null;
  depositDueDate: string | null;
  balancePercent: number | null;
  balanceDueDate: string | null;
  /* Exactly one of these is set, matching orderType. */
  vetItems?: VetLineItem[];
  f1Items?: F1LineItem[];
  psItems?: PsLineItem[];
  seminarItems?: SeminarLineItem[];
}

/* Customer core columns repeated across the monitoring tables. */
export interface CustomerColumns {
  customerNumber: string;
  name: string;
  address: string;
  contactNumber: string;
  email: string;
  facebookName: string;
}

export interface SeminarProgressRow extends CustomerColumns {
  /* Backend customer-profile UUID. */
  id?: string;
  occupationLocation: string;
  status: "In Progress" | "Completed" | "Failed";
  modules: string;
  seminarId: string;
  registrationDate: string;
  payDate: string;
  /*
   * The account's auto-generated Certificate of Attendance, created by
   * the backend the moment Modules 1-3 are complete. certificateIssuedAt
   * is its issue date and certificateValidUntil that date + 2 years,
   * both stamped on the record at generation; Valid/Expired is derived
   * from certificateValidUntil at render time. hasCertificateFile is
   * true only for records carrying a file from the retired manual
   * workflow.
   */
  certificateRequestId: string | null;
  hasCertificateFile: boolean;
  certificateFileName: string | null;
  certificateIssuedAt: string | null;
  certificateValidUntil: string | null;
}

/* Customer Order Tracking row: order + customer + logistics columns. */
export interface OrderTrackingRow extends CustomerColumns {
  id: string;
  source: "LIVE" | "HISTORICAL_IMPORT";
  trackingStatus: "Processing" | "Shipped" | "Delivered";
  receiverName: string;
  receiverFacebook: string;
  receiverContact: string;
  quantity: number;
  totalAmount: number;
  hatchDate: string | null;
  airportLocation: string | null;
  paymentDate: string | null;
  instructions: string | null;
  feeTotal: number;
  pickupBranch: string | null;
}

export interface BreederMonitoringRow extends CustomerColumns {
  /* Backend monitoring UUID. */
  id?: string;
  farmName: string;
  farmAddress: string;
  breederDate: string | null;
  numberAlive: string | null;
  vaccinationRecords: string | null;
  feedingHealthWeight: string | null;
  breedersClaimed: string | null;
  overallStatus: "ACTIVE" | "PENDING" | "EXPIRED" | "INELIGIBLE";
  farmLogo: string;
}

export interface TicketRow extends CustomerColumns {
  /* Backend ticket UUID. */
  id?: string;
  ticketNumber: string;
  subject: string;
  category: string | null;
  priority: string | null;
  status: "SUBMITTED" | "UNDER_REVIEW" | "RESPONDED" | "CLOSED";
  createdAt: string;
}

/* GET /api/seminars/modules (staff view) */
export interface SeminarModuleSummary {
  /* Backend UUID; the URL/route identity stays moduleNumber. */
  id?: string;
  moduleNumber: number;
  title: string;
  description: string;
  videoCount: number;
  questionCount: number;
  passingScore: number;
  /* Module access price in pesos; 0 = free module. */
  price: number;
  isPublished: boolean;
  /*
   * Content was edited after the last publish (videos/questions/title/
   * grade/certificate). Set by successful content saves on a published
   * module, cleared only by Publish/Unpublish. Optional so stores
   * persisted before this field existed hydrate as "no pending changes".
   */
  hasUnpublishedChanges?: boolean;
}

export interface SeminarVideoItem {
  id: string;
  title: string;
  duration: string;
  displayOrder: number;
  /* Name of the uploaded video file. */
  fileName?: string;
  /* Backend storage URL (/uploads/seminar-videos/...) or external URL. */
  videoUrl?: string;
}

export interface SeminarQuestionItem {
  id: string;
  questionText: string;
  choices: Array<{ id: string; choiceText: string; isCorrect: boolean }>;
}

/* GET /api/historical/files */
export interface HistoricalFileRow {
  id: string;
  originalName: string;
  category: string | null;
  year: number | null;
  sizeBytes: number;
  createdAt: string;
  itemCount: number | null; // folders group by category in the UI
  kind?: "xlsx" | "pdf";
  /* Absolute backend file URL (/uploads static route) used for the
     in-page preview and downloads. Synthetic folder rows have none. */
  storageUrl?: string | null;
  /* Legacy mock field: small uploads kept their content as a data URL.
     Server-backed rows use storageUrl instead. */
  dataUrl?: string;
}

/* GET /api/users */
export interface StaffUserRow {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  lastLogin: string;
  /* Profile image; new accounts default to the DACS logo. */
  avatarUrl?: string;
}

/* Dashboard visuals (Create Visual builder; max 12 on the page). */
export type VisualType =
  | "clustered-bar"
  | "clustered-column"
  | "stacked-bar"
  | "stacked-column"
  | "line"
  | "line-clustered-column"
  | "line-stacked-column"
  | "pie"
  | "donut"
  | "kpi"
  | "table"
  | "filled-map"
  | "heatmap";

export interface DashboardVisual {
  id: string;
  type: VisualType;
  title: string;
  /*
   * Builder picks — IDs from the backend analytics field catalog
   * (GET /api/analytics/fields). dataset is null on built-in visuals
   * and on legacy visuals created against the removed sample table;
   * legacy customs render an honest "obsolete" state, never numbers.
   */
  dataset: string | null;
  xField: string | null;
  xBucket: string | null;
  yField: string | null;
  aggregation: string | null;
  legendField: string | null;
  /* Built-in visuals ship with the app and render their fixed chart. */
  builtin?: string;
}

/* ---- Backend analytics field catalog (GET /api/analytics/fields) ---- */

export type AnalyticsDimensionKind = "category" | "date" | "geo";
export type AnalyticsAggregation = "count" | "sum" | "avg" | "min" | "max";
export type AnalyticsMeasureFormat = "count" | "number" | "currency" | "percent";

export interface AnalyticsDimension {
  id: string;
  label: string;
  kind: AnalyticsDimensionKind;
  /* Values are raw database enum tokens — title-case them for display. */
  enumLike?: boolean;
}

export interface AnalyticsMeasure {
  id: string;
  label: string;
  format: AnalyticsMeasureFormat;
  aggregations: AnalyticsAggregation[];
}

export interface AnalyticsDataset {
  id: string;
  label: string;
  description: string;
  dimensions: AnalyticsDimension[];
  measures: AnalyticsMeasure[];
}

export interface AnalyticsFieldCatalog {
  generatedAt: string;
  dateBuckets: Array<{ id: string; label: string }>;
  datasets: AnalyticsDataset[];
}

/* ---- One aggregated series (GET /api/analytics/query) ---- */

export interface AnalyticsQueryRow {
  x: string | null;
  legend: string | null;
  value: number | null;
}

export interface AnalyticsQueryResult {
  generatedAt: string;
  dataset: string;
  x: {
    field: string;
    label: string;
    kind: AnalyticsDimensionKind;
    bucket: string | null;
    enumLike?: boolean;
  } | null;
  legend: {
    field: string;
    label: string;
    kind: AnalyticsDimensionKind;
    enumLike?: boolean;
  } | null;
  measure: {
    field: string;
    label: string;
    format: AnalyticsMeasureFormat;
    aggregation: AnalyticsAggregation;
  };
  rows: AnalyticsQueryRow[];
  truncated: boolean;
}

/* Settings > General editable blocks. */
export interface CompanyInfo {
  companyName: string;
  businessAddress: string;
  contactNumber: string;
  emailAddress: string;
  facebookPage: string;
  website: string;
  /* Uploaded logo (data URL); falls back to the bundled logo asset. */
  logoImage?: string;
}

export interface UserInfo {
  fullName: string;
  position: string;
  emailAddress: string;
  contactNumber: string;
  /* Uploaded profile photo (data URL); falls back to the bundled one. */
  photoImage?: string;
}

/* Activity log rows for the Settings > Audit Logs screen. */
export interface AuditLogRow {
  id: string;
  createdAt: string;
  userEmail: string;
  roleLabel: string;
  module: string;
  action: string;
  description: string;
}

/* GET /api/notifications */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

/* Form-builder block model (feeds orders on submission, per the client). */
export type FormFieldType =
  | "title"
  | "paragraph"
  | "short-answer"
  | "file-upload"
  | "dropdown"
  | "choice"
  | "number"
  | "checkbox"
  | "date"
  | "time"
  | "button"
  | "conditional";

export interface FormBlock {
  id: string;
  type: FormFieldType;
  /* The typed-in content: a title's text, a field's label, a button's
     caption, and so on. */
  label: string;
  options?: string[];
  /* Customer-input settings (per the field redesign). */
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  timeFormat?: "12-hour" | "24-hour";
}

export interface FormDefinition {
  id: string;
  name: string;
  description: string;
  isPublished: boolean;
  blocks: FormBlock[];
}
