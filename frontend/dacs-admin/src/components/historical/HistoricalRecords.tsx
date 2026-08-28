"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

import { ImageModal, Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination, TableShell, Td, Th } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  getHistoricalRecord,
  listHistoricalRecords,
  reviewHistoricalRecord,
  type ApiHistoricalRecord,
  type ApiHistoricalRecordDetail,
  type HistoricalRecordType,
  type HistoricalValidationStatus,
} from "@/lib/api/historical";
import { appendAudit } from "@/lib/audit";
import { formatDate, formatPeso, formatSlashDate } from "@/lib/format";

/*
 * Shared building blocks for the lossless historical layer
 * (historical_source_records): a server-paginated, searchable records
 * table reused by the Historical Data file view and the operational
 * monitoring pages, plus the full record detail modal.
 *
 * Everything here is read from the DACS backend with server-side
 * pagination — the admin never downloads all 1,500+ records at once.
 */

const RECORD_TYPE_LABELS: Record<HistoricalRecordType, string> = {
  BREEDER_CERTIFICATE: "Breeder Certificate",
  SEMINAR: "Seminar",
  PARENT_STOCK: "Parent Stock",
  ORDER: "Order",
};

/* Case-insensitive rawData lookup by header prefix, for order rows that
   never produced a normalized order (the source cells are the display). */
function rawCell(record: ApiHistoricalRecord, prefix: string): string | null {
  for (const [header, value] of Object.entries(record.rawData)) {
    if (header.toLowerCase().startsWith(prefix)) return value;
  }
  return null;
}

/* Purple chip marking legacy rows apart from live workflow records. */
export function HistoricalImportBadge({ label = "Historical Import" }: { label?: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full bg-purple-100 px-3.5 py-1 text-sm font-medium text-purple-800">
      {label}
    </span>
  );
}

function joinName(profile: {
  firstName: string;
  middleName: string | null;
  lastName: string;
}): string {
  return [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean)
    .join(" ");
}

/*
 * Date cell: parsed dates render as slash dates; unparseable legacy
 * values fall back to the preserved raw text in the review tint (the
 * original is never replaced with a guess).
 */
function DateValue({ iso, raw }: { iso: string | null; raw: string | null }) {
  if (iso) return <>{formatSlashDate(iso.slice(0, 10))}</>;
  if (raw) {
    return (
      <span className="text-orange-700" title="Original value — could not be read as a date">
        {raw}
      </span>
    );
  }
  return <span className="text-dacs-muted">N/A</span>;
}

function ModuleValue({ record }: { record: ApiHistoricalRecord }) {
  if (record.legacyModuleNumber !== null) return <>{record.legacyModuleNumber}</>;
  if (record.legacyModuleRaw) {
    return (
      <span
        className="text-orange-700"
        title="Original value — not a recognizable module number"
      >
        {record.legacyModuleRaw}
      </span>
    );
  }
  return <span className="text-dacs-muted">N/A</span>;
}

function textOr(value: string | null): React.ReactNode {
  return value ? value : <span className="text-dacs-muted">N/A</span>;
}

/* Long free-text cells (vaccination etc.): clamped in the table, full
   content in the detail modal. */
function LongText({ value }: { value: string | null }) {
  if (!value) return <span className="text-dacs-muted">N/A</span>;
  return (
    <span
      className="block max-w-[280px] whitespace-pre-line text-left [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box] [overflow:hidden]"
      title="Open the record to read the full text"
    >
      {value}
    </span>
  );
}

function LinkedCustomerCell({ record }: { record: ApiHistoricalRecord }) {
  if (!record.customerProfile) {
    return <span className="text-dacs-muted">Unlinked</span>;
  }
  return (
    <span title={joinName(record.customerProfile)}>
      {record.customerProfile.customerNumber}
    </span>
  );
}

/* ---------------------------------------------------------------- */
/* Detail modal                                                      */
/* ---------------------------------------------------------------- */

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[190px_1fr] gap-3 border-b border-dacs-light py-2.5 text-[15px] last:border-b-0">
      <span className="font-semibold text-dacs-muted">{label}</span>
      <span className="min-w-0 whitespace-pre-line break-words">{value}</span>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-1 text-lg font-bold">{title}</h3>
      <div>{children}</div>
    </section>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  error: "bg-red-100 text-red-700",
  warning: "bg-orange-100 text-orange-800",
  info: "bg-blue-100 text-blue-800",
};

export function HistoricalRecordDetailModal({
  recordId,
  onClose,
  onChanged,
}: {
  recordId: string;
  onClose: () => void;
  /* Called after a successful review so tables can refresh. */
  onChanged?: () => void;
}) {
  const { showToast } = useToast();
  const [record, setRecord] = useState<ApiHistoricalRecordDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState(recordId);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [viewingLogo, setViewingLogo] = useState(false);

  const load = useCallback(async (id: string) => {
    setRecord(null);
    setLoadError(null);
    try {
      setRecord(await getHistoricalRecord(id));
    } catch (error) {
      setLoadError(
        errorMessage(error, "Unable to load this historical record. Please try again.")
      );
    }
  }, []);

  useEffect(() => {
    void load(viewingId);
  }, [load, viewingId]);

  async function submitReview() {
    if (reviewing || !record) return;
    setReviewing(true);
    try {
      await reviewHistoricalRecord(record.id, reviewNotes.trim() || null);
      appendAudit(
        "Historical",
        "HISTORICAL_RECORD_REVIEWED",
        `Marked historical record (sheet "${record.sheetName}", row ${record.rowNumber}) as reviewed.`
      );
      showToast("Historical record marked as reviewed.");
      setReviewOpen(false);
      setReviewNotes("");
      await load(record.id);
      onChanged?.();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to mark this record as reviewed. Please try again."),
        "error"
      );
    } finally {
      setReviewing(false);
    }
  }

  const isSeminar = record?.recordType === "SEMINAR";
  const isParentStock = record?.recordType === "PARENT_STOCK";
  const isBreederCertificate = record?.recordType === "BREEDER_CERTIFICATE";
  const isOrder = record?.recordType === "ORDER";

  return (
    <Modal onClose={onClose} width="max-w-[860px]">
      {!record && !loadError && (
        <p className="py-16 text-center text-sm text-dacs-muted">Loading record…</p>
      )}
      {!record && loadError && (
        <p className="py-16 text-center text-sm text-dacs-muted">{loadError}</p>
      )}

      {record && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-b border-dacs-light pb-4 pr-10">
            <h2 className="min-w-0 text-xl font-bold">
              {record.fullName ?? "Historical Record"}
            </h2>
            <HistoricalImportBadge label={RECORD_TYPE_LABELS[record.recordType]} />
            <StatusBadge status={record.validationStatus} />
            {record.reviewedAt && (
              <span className="inline-block rounded-full bg-gray-100 px-3.5 py-1 text-sm font-medium text-gray-700">
                Reviewed
              </span>
            )}
          </div>

          {/* ---- Source provenance ---- */}
          <DetailSection title="Source">
            <DetailRow
              label="File"
              value={record.import?.historicalFile?.originalName ?? record.sourceFilename}
            />
            <DetailRow label="Sheet" value={record.sheetName} />
            <DetailRow label="Row" value={String(record.rowNumber)} />
            <DetailRow label="Imported" value={formatDate(record.createdAt)} />
          </DetailSection>

          {/* ---- Customer ---- */}
          <DetailSection title="Customer">
            <DetailRow label="Name" value={textOr(record.fullName)} />
            <DetailRow label="Email" value={textOr(record.email)} />
            {record.occupation !== null && (
              <DetailRow label="Occupation & Location" value={record.occupation} />
            )}
            <DetailRow label="Contact #" value={textOr(record.phone)} />
            <DetailRow label="Facebook" value={textOr(record.facebook)} />
            <DetailRow label="Address" value={textOr(record.address)} />
            <DetailRow
              label="Linked DACS customer"
              value={
                record.customerProfile ? (
                  <>
                    <span className="font-semibold">
                      {record.customerProfile.customerNumber}
                    </span>{" "}
                    — {joinName(record.customerProfile)}
                    {record.customerProfile.userId
                      ? " (claimed account)"
                      : " (unclaimed historical profile)"}
                  </>
                ) : (
                  <span className="text-dacs-muted">
                    Not linked — the row has no valid customer identity.
                  </span>
                )
              }
            />
          </DetailSection>

          {/* ---- Order (normalized DACS order + payment summaries) ---- */}
          {isOrder && (
            <DetailSection title="Order">
              <DetailRow
                label="Order Number"
                value={textOr(record.orderNumber)}
              />
              {record.order ? (
                <>
                  <DetailRow
                    label="DACS Order"
                    value={
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <HistoricalImportBadge label="Imported Order" />
                        <StatusBadge status={record.order.status} />
                      </span>
                    }
                  />
                  <DetailRow label="Order Type" value={record.order.orderType} />
                  <DetailRow
                    label="Order Date"
                    value={formatSlashDate(record.order.createdAt.slice(0, 10))}
                  />
                  <DetailRow
                    label="Date Needed"
                    value={
                      record.order.dateNeeded ? (
                        formatSlashDate(record.order.dateNeeded.slice(0, 10))
                      ) : (
                        <span className="text-dacs-muted">N/A</span>
                      )
                    }
                  />
                  {record.order.releasedAt && (
                    <DetailRow
                      label="Release Date"
                      value={formatSlashDate(record.order.releasedAt.slice(0, 10))}
                    />
                  )}
                  <DetailRow
                    label="Fulfillment"
                    value={
                      record.order.fulfillmentMethod ? (
                        `${record.order.fulfillmentMethod}${
                          record.order.airportLocation ??
                          record.order.pickupBranch ??
                          record.order.deliveryAddress
                            ? ` — ${
                                record.order.airportLocation ??
                                record.order.pickupBranch ??
                                record.order.deliveryAddress
                              }`
                            : ""
                        }`
                      ) : (
                        <span className="text-dacs-muted">N/A</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Receiver"
                    value={
                      record.order.receiverName ? (
                        [
                          record.order.receiverName,
                          record.order.receiverContact,
                          record.order.receiverFacebook,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      ) : (
                        <span className="text-dacs-muted">N/A</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Items"
                    value={
                      <span className="flex flex-col gap-1">
                        {record.order.items.map((item) => (
                          <span key={item.id}>
                            {item.productNameSnapshot} ({item.productCodeSnapshot})
                            — {item.quantity} ×{" "}
                            {formatPeso(Number(item.unitPriceSnapshot))} ={" "}
                            {formatPeso(Number(item.lineTotal))}
                          </span>
                        ))}
                      </span>
                    }
                  />
                  <DetailRow
                    label="Totals"
                    value={`Subtotal ${formatPeso(Number(record.order.subtotal))} + Fee ${formatPeso(Number(record.order.feeTotal))} = ${formatPeso(Number(record.order.totalAmount))}`}
                  />
                  <DetailRow
                    label="Payment History"
                    value={
                      record.order.payments.length === 0 ? (
                        <span className="text-dacs-muted">
                          No payment records for this order.
                        </span>
                      ) : (
                        <span className="flex flex-col gap-1">
                          {record.order.payments.map((payment) => (
                            <span
                              key={payment.id}
                              className="flex flex-wrap items-center gap-2"
                            >
                              {payment.paymentType} ·{" "}
                              {formatPeso(Number(payment.amount))} ·{" "}
                              {payment.paymentDate
                                ? formatSlashDate(payment.paymentDate.slice(0, 10))
                                : "no date"}{" "}
                              · {payment.referenceNumber ?? "no reference"}
                              <StatusBadge status={payment.status} />
                              {!payment.proofStorageUrl && (
                                <span className="text-sm text-dacs-muted">
                                  No proof file — historical import
                                </span>
                              )}
                            </span>
                          ))}
                        </span>
                      )
                    }
                  />
                </>
              ) : (
                <DetailRow
                  label="DACS Order"
                  value={
                    <span className="text-dacs-muted">
                      No DACS order was created from this row — see the
                      validation notes below; every source cell is preserved
                      underneath.
                    </span>
                  }
                />
              )}
            </DetailSection>
          )}

          {/* ---- Seminar ---- */}
          {isSeminar && (
            <DetailSection title="Seminar">
              <DetailRow label="Module #" value={<ModuleValue record={record} />} />
              <DetailRow label="Seminar ID" value={textOr(record.seminarReference)} />
              <DetailRow
                label="Registration Date"
                value={
                  <DateValue
                    iso={record.registrationDate}
                    raw={record.registrationDateRaw}
                  />
                }
              />
              <DetailRow
                label="Pay Date"
                value={<DateValue iso={record.payDate} raw={record.payDateRaw} />}
              />
              <DetailRow
                label="DACS e-learning link"
                value={
                  <span className="text-dacs-muted">
                    None — legacy seminar attendance predates the DACS modules, so
                    it is preserved here instead of being converted into a live
                    enrollment.
                  </span>
                }
              />
            </DetailSection>
          )}

          {/* ---- Farm / Breeder ---- */}
          {isParentStock && (
            <DetailSection title="Farm / Breeder">
              <DetailRow label="Farm Name" value={textOr(record.farmName)} />
              <DetailRow label="Farm Address" value={textOr(record.farmAddress)} />
              <DetailRow
                label="Linked DACS farm"
                value={
                  record.farm ? (
                    record.farm.farmName
                  ) : (
                    <span className="text-dacs-muted">Not linked</span>
                  )
                }
              />
              <DetailRow
                label="Date Breeders Acquired"
                value={
                  <DateValue
                    iso={record.breedersAcquiredAt}
                    raw={record.breedersAcquiredRaw}
                  />
                }
              />
              <DetailRow
                label="Heads per Variety"
                value={textOr(record.breederHeads)}
              />
              <DetailRow
                label="Records of Vaccination"
                value={textOr(record.vaccinationRecords)}
              />
              <DetailRow
                label="Feeding, Health, Weight Management"
                value={textOr(record.managementRecords)}
              />
              <DetailRow
                label="# of Breeders Claimed"
                value={textOr(record.breedersClaimed)}
              />
              <DetailRow
                label="Farm Logo"
                value={
                  record.farmLogoUrl ? (
                    <button
                      type="button"
                      onClick={() => setViewingLogo(true)}
                      className="font-semibold text-dacs-red underline hover:opacity-80"
                    >
                      View Image
                    </button>
                  ) : (
                    textOr(record.farmLogoValue)
                  )
                }
              />
            </DetailSection>
          )}

          {/* ---- Receiver / Pickup ---- */}
          {isBreederCertificate && (
            <DetailSection title="Receiver / Pickup">
              <DetailRow
                label="Pickup Location"
                value={textOr(record.pickupLocation)}
              />
              <DetailRow
                label="Receiver Contact #"
                value={textOr(record.receiverPhone)}
              />
              <DetailRow
                label="Receiver Facebook"
                value={textOr(record.receiverFacebook)}
              />
            </DetailSection>
          )}

          {/* ---- Validation ---- */}
          {(record.validationMessages?.length ?? 0) > 0 && (
            <DetailSection title="Validation">
              <ul className="flex flex-col gap-2">
                {record.validationMessages!.map((message, index) => (
                  <li key={index} className="flex items-start gap-2 text-[15px]">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                        SEVERITY_STYLES[message.severity] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {message.severity}
                    </span>
                    <span>{message.message}</span>
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          {/* ---- Review state ---- */}
          {record.reviewedAt && (
            <DetailSection title="Review">
              <DetailRow label="Reviewed on" value={formatDate(record.reviewedAt)} />
              {record.reviewedBy && (
                <DetailRow label="Reviewed by" value={record.reviewedBy.email} />
              )}
              {record.reviewNotes && (
                <DetailRow label="Notes" value={record.reviewNotes} />
              )}
            </DetailSection>
          )}

          {/* ---- Other imported records for this customer ---- */}
          {record.relatedRecords.length > 0 && (
            <DetailSection title="More historical records for this customer">
              <div className="flex flex-col gap-1">
                {record.relatedRecords.map((related) => (
                  <button
                    key={related.id}
                    type="button"
                    onClick={() => setViewingId(related.id)}
                    className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[15px] hover:bg-dacs-light/60"
                  >
                    <span className="font-semibold text-dacs-red">
                      {RECORD_TYPE_LABELS[related.recordType]}
                    </span>
                    <span className="text-dacs-muted">
                      {related.sheetName} · row {related.rowNumber}
                    </span>
                    <StatusBadge status={related.validationStatus} />
                  </button>
                ))}
              </div>
            </DetailSection>
          )}

          {/* ---- Original source cells ---- */}
          <DetailSection title="Original spreadsheet cells">
            <div className="rounded-lg border border-dacs-light bg-dacs-light/30 p-4">
              {Object.entries(record.rawData).map(([header, value]) => (
                <DetailRow key={header} label={header} value={value} />
              ))}
            </div>
          </DetailSection>

          {/* ---- Actions ---- */}
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-dacs-light pt-4">
            {!record.reviewedAt && !reviewOpen && (
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
              >
                Mark as Reviewed
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-dacs-dark/40 px-6 py-2.5 font-semibold hover:bg-dacs-light/50"
            >
              Close
            </button>
          </div>

          {reviewOpen && (
            <div className="mt-4 rounded-lg border border-dacs-light p-4">
              <label className="mb-2 block font-semibold" htmlFor="review-notes">
                Review notes (optional)
              </label>
              <textarea
                id="review-notes"
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Legacy Excel formatting confirmed — module number unknown."
                className="w-full rounded-lg border border-dacs-dark/30 p-3 text-sm outline-none focus:border-dacs-dark"
              />
              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={() => void submitReview()}
                  className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {reviewing ? "Saving…" : "Confirm Review"}
                </button>
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={() => setReviewOpen(false)}
                  className="rounded-2xl border border-dacs-dark/40 px-6 py-2.5 font-semibold hover:bg-dacs-light/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {viewingLogo && record.farmLogoUrl && (
            <ImageModal
              src={record.farmLogoUrl}
              alt={`${record.farmName ?? "Farm"} logo`}
              onClose={() => setViewingLogo(false)}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- */
/* Server-paginated records table                                    */
/* ---------------------------------------------------------------- */

const STATUS_FILTERS: Array<{ value: "" | HistoricalValidationStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "VALID", label: "Valid" },
  { value: "PARTIAL", label: "Partial" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "INVALID", label: "Invalid" },
];

const LINKED_FILTERS = [
  { value: "", label: "Linked + unlinked" },
  { value: "true", label: "Linked to a customer" },
  { value: "false", label: "Unlinked" },
] as const;

export function HistoricalRecordsTable({
  recordType,
  historicalFileId,
  sheetName,
  searchPlaceholder = "Search records...",
}: {
  recordType?: HistoricalRecordType;
  historicalFileId?: string;
  sheetName?: string;
  searchPlaceholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<"" | HistoricalValidationStatus>("");
  const [linked, setLinked] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<ApiHistoricalRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingRecordId, setViewingRecordId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  /* Debounce typing so every keystroke doesn't hit the API. */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, status, linked, recordType, sheetName, historicalFileId]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const result = await listHistoricalRecords({
        recordType,
        historicalFileId,
        sheetName,
        validationStatus: status === "" ? undefined : status,
        linked: linked === "" ? undefined : linked === "true",
        search: debouncedSearch || undefined,
        page: page + 1,
        pageSize: 10,
      });
      if (seq !== requestSeq.current) return;
      setRows(result.items);
      setTotal(result.total);
      setLoadError(null);
    } catch (error) {
      if (seq !== requestSeq.current) return;
      setLoadError(
        errorMessage(error, "Unable to load historical records. Please try again.")
      );
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [recordType, historicalFileId, sheetName, status, linked, debouncedSearch, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Columns follow the actual source sheet of the records shown. */
  const kind: HistoricalRecordType = useMemo(() => {
    if (recordType) return recordType;
    const name = (sheetName ?? "").toLowerCase();
    if (name.includes("order")) return "ORDER";
    if (name.includes("seminar")) return "SEMINAR";
    if (name.includes("ps") || name.includes("parent")) return "PARENT_STOCK";
    return "BREEDER_CERTIFICATE";
  }, [recordType, sheetName]);

  const headers: string[] =
    kind === "ORDER"
      ? [
          "Row",
          "Customer",
          "Email",
          "Order #",
          "Product",
          "Qty",
          "Order Total",
          "Order Status",
          "DACS Order",
          "Linked Customer",
          "Status",
        ]
      : kind === "SEMINAR"
      ? [
          "Row",
          "Participant",
          "Email",
          "Occupation & Location",
          "Contact #",
          "Facebook",
          "Address",
          "Module #",
          "Seminar ID #",
          "Registration Date",
          "Pay Date",
          "Linked Customer",
          "Status",
        ]
      : kind === "PARENT_STOCK"
        ? [
            "Row",
            "Owner",
            "Email",
            "Farm",
            "Farm Address",
            "Contact #",
            "Facebook / Page",
            "Date Acquired",
            "Heads per Variety",
            "Records of Vaccination",
            "Feeding, Health, Weight Mgmt",
            "# Claimed",
            "Farm Logo",
            "Linked Customer",
            "Status",
          ]
        : [
            "Row",
            "Name",
            "Email",
            "Address",
            "Contact #",
            "Facebook / Messenger",
            "Pickup Location",
            "Receiver Contact",
            "Receiver Facebook",
            "Linked Customer",
            "Status",
          ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[360px]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-full border border-dacs-dark/40 py-2.5 pl-5 pr-11 text-sm italic outline-none focus:border-dacs-dark"
          />
          <Search
            size={18}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-dacs-dark"
          />
        </div>
        <select
          value={status}
          aria-label="Filter by validation status"
          onChange={(event) =>
            setStatus(event.target.value as "" | HistoricalValidationStatus)
          }
          className="rounded-full border border-dacs-dark/40 bg-white px-4 py-2.5 text-sm outline-none focus:border-dacs-dark"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={linked}
          aria-label="Filter by customer link"
          onChange={(event) => setLinked(event.target.value as "" | "true" | "false")}
          className="rounded-full border border-dacs-dark/40 bg-white px-4 py-2.5 text-sm outline-none focus:border-dacs-dark"
        >
          {LINKED_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <TableShell>
        <thead>
          <tr>
            {headers.map((header) => (
              <Th key={header}>{header}</Th>
            ))}
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={headers.length + 1}>
                Loading historical records…
              </Td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={headers.length + 1}>
                {loadError}
              </Td>
            </tr>
          )}
          {!loading &&
            !loadError &&
            rows.map((row) => (
              <tr key={row.id}>
                <Td>{row.rowNumber}</Td>
                <Td className="font-semibold text-dacs-red">
                  {row.fullName ?? "N/A"}
                </Td>
                <Td>{textOr(row.email)}</Td>

                {kind === "ORDER" && (
                  <>
                    <Td>{textOr(row.orderNumber)}</Td>
                    <Td>
                      {row.order ? (
                        <span
                          className="block max-w-[220px] truncate"
                          title={row.order.items
                            .map((item) => item.productNameSnapshot)
                            .join(", ")}
                        >
                          {row.order.items
                            .map((item) => item.productNameSnapshot)
                            .join(", ") || "N/A"}
                        </span>
                      ) : (
                        textOr(rawCell(row, "product name"))
                      )}
                    </Td>
                    <Td>
                      {row.order
                        ? row.order.items.reduce(
                            (sum, item) => sum + item.quantity,
                            0
                          )
                        : textOr(rawCell(row, "quantity"))}
                    </Td>
                    <Td>
                      {row.order
                        ? formatPeso(Number(row.order.totalAmount))
                        : textOr(rawCell(row, "total amount"))}
                    </Td>
                    <Td>
                      {row.order ? (
                        <StatusBadge status={row.order.status} />
                      ) : (
                        textOr(rawCell(row, "status"))
                      )}
                    </Td>
                    <Td>
                      {row.order ? (
                        <HistoricalImportBadge label="Imported Order" />
                      ) : (
                        <span
                          className="text-dacs-muted"
                          title="No DACS order was created from this row — open the record for the reason"
                        >
                          Not created
                        </span>
                      )}
                    </Td>
                  </>
                )}

                {kind === "SEMINAR" && (
                  <>
                    <Td>{textOr(row.occupation)}</Td>
                    <Td>{textOr(row.phone)}</Td>
                    <Td>{textOr(row.facebook)}</Td>
                    <Td>{textOr(row.address)}</Td>
                    <Td>
                      <ModuleValue record={row} />
                    </Td>
                    <Td>{textOr(row.seminarReference)}</Td>
                    <Td>
                      <DateValue
                        iso={row.registrationDate}
                        raw={row.registrationDateRaw}
                      />
                    </Td>
                    <Td>
                      <DateValue iso={row.payDate} raw={row.payDateRaw} />
                    </Td>
                  </>
                )}

                {kind === "PARENT_STOCK" && (
                  <>
                    <Td>{textOr(row.farmName)}</Td>
                    <Td>{textOr(row.farmAddress)}</Td>
                    <Td>{textOr(row.phone)}</Td>
                    <Td>{textOr(row.facebook)}</Td>
                    <Td>
                      <DateValue
                        iso={row.breedersAcquiredAt}
                        raw={row.breedersAcquiredRaw}
                      />
                    </Td>
                    <Td>
                      <LongText value={row.breederHeads} />
                    </Td>
                    <Td>
                      <LongText value={row.vaccinationRecords} />
                    </Td>
                    <Td>
                      <LongText value={row.managementRecords} />
                    </Td>
                    <Td>
                      <LongText value={row.breedersClaimed} />
                    </Td>
                    <Td>
                      {row.farmLogoUrl ? (
                        <span className="font-semibold text-dacs-red">Image</span>
                      ) : (
                        textOr(row.farmLogoValue)
                      )}
                    </Td>
                  </>
                )}

                {kind === "BREEDER_CERTIFICATE" && (
                  <>
                    <Td>{textOr(row.address)}</Td>
                    <Td>{textOr(row.phone)}</Td>
                    <Td>{textOr(row.facebook)}</Td>
                    <Td>{textOr(row.pickupLocation)}</Td>
                    <Td>{textOr(row.receiverPhone)}</Td>
                    <Td>{textOr(row.receiverFacebook)}</Td>
                  </>
                )}

                <Td>
                  <LinkedCustomerCell record={row} />
                </Td>
                <Td>
                  <StatusBadge status={row.validationStatus} />
                </Td>
                <Td>
                  <button
                    type="button"
                    onClick={() => setViewingRecordId(row.id)}
                    className="font-semibold text-dacs-red underline hover:opacity-80"
                  >
                    View
                  </button>
                </Td>
              </tr>
            ))}
          {!loading && !loadError && rows.length === 0 && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={headers.length + 1}>
                No historical records match the current search/filter.
              </Td>
            </tr>
          )}
        </tbody>
      </TableShell>

      <Pagination page={page} total={total} onPageChange={setPage} />

      {viewingRecordId && (
        <HistoricalRecordDetailModal
          recordId={viewingRecordId}
          onClose={() => setViewingRecordId(null)}
          onChanged={() => void load()}
        />
      )}
    </>
  );
}
