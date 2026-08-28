/*
 * Historical Data endpoints (staff only: Owner + Administrative Staff).
 * Mirrors back end/src/modules/historical.
 */
import { api } from "../api";

export interface ApiSpreadsheetImport {
  id: string;
  historicalFileId: string;
  sheetName: string;
  rowsProcessed: number;
  customersCreated: number;
  farmsCreated: number;
  duplicateRows: number;
  errorRows: number;
  sourceRecordsCreated: number;
  ordersCreated: number;
  orderItemsCreated: number;
  paymentsCreated: number;
  createdByUserId: string | null;
  createdAt: string;
  _count?: {
    errors: number;
    customersImported: number;
    sourceRecords: number;
  };
}

export type HistoricalRecordType =
  | "BREEDER_CERTIFICATE"
  | "SEMINAR"
  | "PARENT_STOCK"
  | "ORDER";

export type HistoricalValidationStatus =
  | "VALID"
  | "PARTIAL"
  | "NEEDS_REVIEW"
  | "INVALID";

export interface ApiHistoricalValidationMessage {
  field: string;
  severity: "error" | "warning" | "info";
  message: string;
}

/* One preserved spreadsheet row (historical_source_records). */
export interface ApiHistoricalRecord {
  id: string;
  importId: string | null;
  sourceFilename: string;
  sheetName: string;
  rowNumber: number;
  recordType: HistoricalRecordType;
  rawData: Record<string, string>;

  email: string | null;
  fullName: string | null;
  phone: string | null;
  facebook: string | null;
  address: string | null;
  occupation: string | null;

  pickupLocation: string | null;
  receiverPhone: string | null;
  receiverFacebook: string | null;

  legacyModuleNumber: number | null;
  legacyModuleRaw: string | null;
  seminarReference: string | null;
  registrationDate: string | null;
  registrationDateRaw: string | null;
  payDate: string | null;
  payDateRaw: string | null;

  farmName: string | null;
  farmAddress: string | null;
  breedersAcquiredAt: string | null;
  breedersAcquiredRaw: string | null;
  breederHeads: string | null;
  vaccinationRecords: string | null;
  managementRecords: string | null;
  breedersClaimed: string | null;
  farmLogoValue: string | null;
  farmLogoUrl: string | null;

  orderNumber: string | null;
  orderId: string | null;

  validationStatus: HistoricalValidationStatus;
  validationMessages: ApiHistoricalValidationMessage[] | null;

  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewNotes: string | null;

  customerProfileId: string | null;
  farmId: string | null;

  createdAt: string;
  updatedAt: string;

  customerProfile: {
    id: string;
    customerNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    userId: string | null;
    archivedAt: string | null;
  } | null;
  farm: { id: string; farmName: string; archivedAt: string | null } | null;
  import: {
    id: string;
    historicalFileId: string;
    sheetName: string;
  } | null;
  /* The normalized order an Orders-sheet row produced (list summary). */
  order: {
    id: string;
    orderNumber: string;
    orderType: string;
    status: string;
    totalAmount: string;
    source: "LIVE" | "HISTORICAL_IMPORT";
    createdAt: string;
    items: Array<{ productNameSnapshot: string; quantity: number }>;
  } | null;
}

/* Full normalized order carried by the record detail view. */
export interface ApiHistoricalRecordOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  dateNeeded: string | null;
  hatchDate: string | null;
  releasedAt: string | null;
  receiverName: string | null;
  receiverContact: string | null;
  receiverFacebook: string | null;
  fulfillmentMethod: string | null;
  deliveryAddress: string | null;
  airportLocation: string | null;
  pickupBranch: string | null;
  instructions: string | null;
  subtotal: string;
  feeTotal: string;
  totalAmount: string;
  source: "LIVE" | "HISTORICAL_IMPORT";
  createdAt: string;
  items: Array<{
    id: string;
    productCodeSnapshot: string;
    productNameSnapshot: string;
    unitPriceSnapshot: string;
    quantity: number;
    lineTotal: string;
  }>;
  payments: Array<{
    id: string;
    paymentType: string;
    amount: string;
    paymentDate: string | null;
    referenceNumber: string | null;
    status: string;
    source: "LIVE" | "HISTORICAL_IMPORT";
    proofStorageUrl: string | null;
  }>;
}

export interface ApiHistoricalRecordDetail
  extends Omit<ApiHistoricalRecord, "order"> {
  import:
    | (NonNullable<ApiHistoricalRecord["import"]> & {
        createdAt: string;
        historicalFile: { id: string; originalName: string } | null;
      })
    | null;
  reviewedBy: { id: string; email: string } | null;
  order: ApiHistoricalRecordOrder | null;
  relatedRecords: Array<{
    id: string;
    recordType: HistoricalRecordType;
    sheetName: string;
    rowNumber: number;
    sourceFilename: string;
    validationStatus: HistoricalValidationStatus;
  }>;
}

export interface HistoricalRecordFilters {
  recordType?: HistoricalRecordType;
  historicalFileId?: string;
  importId?: string;
  sheetName?: string;
  customerProfileId?: string;
  farmId?: string;
  validationStatus?: HistoricalValidationStatus;
  linked?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoricalRecordPage {
  items: ApiHistoricalRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listHistoricalRecords(
  filters: HistoricalRecordFilters
): Promise<HistoricalRecordPage> {
  return api.get<HistoricalRecordPage>("/api/historical/records", {
    recordType: filters.recordType,
    historicalFileId: filters.historicalFileId,
    importId: filters.importId,
    sheetName: filters.sheetName,
    customerProfileId: filters.customerProfileId,
    farmId: filters.farmId,
    validationStatus: filters.validationStatus,
    linked: filters.linked === undefined ? undefined : String(filters.linked),
    search: filters.search,
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 10,
  });
}

export async function getHistoricalRecord(
  recordId: string
): Promise<ApiHistoricalRecordDetail> {
  const response = await api.get<{ data: ApiHistoricalRecordDetail }>(
    `/api/historical/records/${recordId}`
  );
  return response.data;
}

export async function reviewHistoricalRecord(
  recordId: string,
  notes: string | null
): Promise<ApiHistoricalRecord> {
  const response = await api.patch<{ data: ApiHistoricalRecord }>(
    `/api/historical/records/${recordId}/review`,
    { notes }
  );
  return response.data;
}

export async function getHistoricalFile(
  fileId: string
): Promise<ApiHistoricalFile> {
  const response = await api.get<{ data: ApiHistoricalFile }>(
    `/api/historical/files/${fileId}`
  );
  return response.data;
}

export async function reimportHistoricalFile(fileId: string): Promise<{
  message?: string;
  data: { file: ApiHistoricalFile; imports: ApiSpreadsheetImport[] };
}> {
  return api.post(`/api/historical/files/${fileId}/reimport`);
}

export interface ApiHistoricalFile {
  id: string;
  originalName: string;
  /* Absolute URL served by the backend's public /uploads static route. */
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  category: string | null;
  year: number | null;
  description: string | null;
  uploadedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  uploadedBy?: { id: string; email: string } | null;
  imports: ApiSpreadsheetImport[];
}

export async function listHistoricalFiles(filters?: {
  search?: string;
  category?: string;
  year?: number;
}): Promise<ApiHistoricalFile[]> {
  const response = await api.get<{ data: ApiHistoricalFile[] }>(
    "/api/historical/files",
    filters
  );
  return response.data;
}

export async function uploadHistoricalFile(file: File): Promise<{
  message?: string;
  data: { file: ApiHistoricalFile; imports: ApiSpreadsheetImport[] };
}> {
  const formData = new FormData();
  formData.append("file", file);
  return api.upload("/api/historical/files", formData);
}

export async function deleteHistoricalFile(fileId: string): Promise<void> {
  await api.del(`/api/historical/files/${fileId}`);
}
