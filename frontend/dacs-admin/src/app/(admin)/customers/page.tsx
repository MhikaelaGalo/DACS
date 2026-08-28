"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Check, Eye, Pencil, X } from "lucide-react";

import { HistoricalImportBadge } from "@/components/historical/HistoricalRecords";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { EditOrderModal } from "@/components/orders/EditOrderModal";
import { QuotationModal } from "@/components/orders/QuotationModal";
import { RecordPaymentModal } from "@/components/orders/RecordPaymentModal";
import {
  applyQuery,
  emptyQuery,
  FilterButton,
  type TableColumn,
  type TableQuery,
} from "@/components/ui/FilterControls";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { pageSlice, Pagination, TableShell, Td, Th } from "@/components/ui/Table";
import { errorMessage } from "@/lib/api";
import {
  getOrder,
  listOrders,
  setOrderPaymentSchedule,
  toOrderEditBody,
  toOrderQueueRow,
  updateOrder,
  updateOrderStatus,
  type ApiOrder,
  type ApiOrderDetail,
} from "@/lib/api/orders";
import { listProducts, type ApiProduct } from "@/lib/api/products";
import { useAutoRefresh, type LoadMode } from "@/lib/useAutoRefresh";
import { formatPeso } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { OrderQueueRow } from "@/types/admin";

const TYPE_LABELS: Record<string, string> = {
  PARENT_STOCK: "PS",
  F1: "F1",
  VETERINARY_PRODUCT: "Veterinary Products",
  SEMINAR: "Seminar",
};

const SOURCE_LABELS: Record<OrderQueueRow["source"], string> = {
  LIVE: "Live",
  HISTORICAL_IMPORT: "Historical Import",
};

const COLUMNS: Array<TableColumn<OrderQueueRow>> = [
  { key: "customerNumber", label: "Customer ID #", get: (row) => row.customerNumber },
  { key: "customerName", label: "Name", get: (row) => row.customerName },
  { key: "orderNumber", label: "Order #", get: (row) => row.orderNumber },
  { key: "orderType", label: "Order Type", get: (row) => TYPE_LABELS[row.orderType] },
  { key: "quantity", label: "Quantity", get: (row) => row.quantity },
  { key: "dateNeeded", label: "Date Needed", get: (row) => row.dateNeeded },
  { key: "status", label: "Status", get: (row) => row.status },
  {
    key: "fulfillmentMethod",
    label: "Fulfillment",
    get: (row) => row.fulfillmentMethod ?? "N/A",
  },
  { key: "source", label: "Source", get: (row) => SOURCE_LABELS[row.source] },
];

/*
 * Order Confirmation Queue (Customer Information landing).
 * Data source: staff GET /api/orders; approve/reject via
 * PATCH /api/orders/:id/status; quotation edits via
 * PATCH /api/orders/:id (+ /payment-schedule for F1/PS dues).
 */
export default function OrderConfirmationQueuePage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<TableQuery>(emptyQuery("customerNumber"));
  const [page, setPage] = useState(0);
  const [apiOrders, setApiOrders] = useState<ApiOrder[]>([]);
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [viewing, setViewing] = useState<OrderQueueRow | null>(null);
  const [viewingDetail, setViewingDetail] = useState<ApiOrderDetail | null>(null);
  const [editing, setEditing] = useState<OrderQueueRow | null>(null);
  const [recordingFor, setRecordingFor] = useState<OrderQueueRow | null>(null);

  const load = useCallback(async (mode: LoadMode) => {
    try {
      const [orders, catalog] = await Promise.all([listOrders(), listProducts()]);
      setApiOrders(orders);
      setProducts(catalog);
      setLoadError(null);
    } catch (error) {
      /* Background refreshes keep the last good rows; the next tick retries. */
      if (mode === "initial") {
        setLoadError(errorMessage(error, "Unable to load orders. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.orders);
  }, []);

  /* New farmer orders land here first — poll so the queue stays current. */
  useAutoRefresh(load, 5_000);

  const rows = useMemo(
    () => apiOrders.map((order) => toOrderQueueRow(order, products)),
    [apiOrders, products]
  );

  const searched = rows.filter((row) =>
    `${row.customerNumber} ${row.customerName} ${row.email} ${row.orderNumber} ${row.productSummary} ${TYPE_LABELS[row.orderType]}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const filtered = applyQuery(searched, COLUMNS, query);
  const paged = pageSlice(filtered, page);

  /* Mutation responses omit customerProfile — keep the loaded one. */
  function mergeOrder(updated: ApiOrder) {
    setApiOrders((current) =>
      current.map((entry) =>
        entry.id === updated.id
          ? { ...updated, customerProfile: entry.customerProfile }
          : entry
      )
    );
  }

  async function decide(row: OrderQueueRow, status: "APPROVED" | "REJECTED") {
    if (deciding) return;
    setDeciding(row.id);
    try {
      mergeOrder(await updateOrderStatus(row.id, status));
      appendAudit(
        "Orders",
        status === "APPROVED" ? "ORDER_APPROVED" : "ORDER_REJECTED",
        `${status === "APPROVED" ? "Approved" : "Rejected"} order ${row.orderNumber}.`
      );
      showToast(
        status === "APPROVED" ? "Order approved." : "Order rejected."
      );
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to update this order. Please try again."),
        "error"
      );
    } finally {
      setDeciding(null);
    }
  }

  async function saveEdit(updated: OrderQueueRow) {
    if (savingEdit) return;
    const original = rows.find((row) => row.id === updated.id);
    const { body, itemCount } = toOrderEditBody(updated);
    if (itemCount === 0) {
      showToast("An order needs at least one item with a quantity.", "error");
      return;
    }

    /* Payment-schedule fields save through their own endpoint and must
       travel together (backend requires all three). */
    const scheduleChanged =
      updated.depositPercent !== original?.depositPercent ||
      updated.depositDueDate !== original?.depositDueDate ||
      updated.balanceDueDate !== original?.balanceDueDate;
    if (
      scheduleChanged &&
      !(updated.depositPercent && updated.depositDueDate && updated.balanceDueDate)
    ) {
      showToast(
        "To change the payment schedule, set the deposit percent and both due dates.",
        "error"
      );
      return;
    }

    setSavingEdit(true);
    try {
      let result = await updateOrder(updated.id, body);
      if (scheduleChanged) {
        result = await setOrderPaymentSchedule(updated.id, {
          depositPercent: updated.depositPercent!,
          depositDueDate: updated.depositDueDate!,
          balanceDueDate: updated.balanceDueDate!,
        });
      }
      mergeOrder(result);
      setEditing(null);
      appendAudit("Orders", "ORDER_UPDATED", `Edited order ${updated.orderNumber}.`);
      showToast("Order updated.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to save this order. Please try again."),
        "error"
      );
    } finally {
      setSavingEdit(false);
    }
  }

  /* The modal's payment history, farms and provenance live on the order
     detail — fetched lazily when the modal opens. */
  function viewOrder(row: OrderQueueRow) {
    setViewing(row);
    setViewingDetail(null);
    void getOrder(row.id)
      .then((detail) => {
        setViewingDetail(detail);
        if (row.orderType === "F1" && row.farmName === null) {
          const primary =
            detail.customerProfile.farms?.find((farm) => farm.isPrimary) ??
            detail.customerProfile.farms?.[0];
          setViewing((current) =>
            current && current.id === row.id
              ? { ...current, farmName: primary?.farmName ?? null }
              : current
          );
        }
      })
      .catch(() => {
        /* The modal falls back to the queue-row data. */
      });
  }

  return (
    <>
      <AdminHeader
        title="Order Confirmation Queue"
        search={{ value: search, onChange: setSearch }}
        right={
          <FilterButton
            rows={rows}
            columns={COLUMNS}
            query={query}
            onChange={setQuery}
          />
        }
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Customer ID #</Th>
            <Th>Name</Th>
            <Th>Order #</Th>
            <Th>Order Type</Th>
            <Th>Product(s)</Th>
            <Th>Quantity</Th>
            <Th>Total</Th>
            <Th>Date Needed</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={11}>
                Loading orders…
              </Td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={11}>
                {loadError}
              </Td>
            </tr>
          )}
          {!loading &&
            !loadError &&
            paged.map((row) => (
              <tr key={row.id}>
                <Td>{row.customerNumber}</Td>
                <Td className="font-semibold text-dacs-red">{row.customerName}</Td>
                <Td>{row.orderNumber}</Td>
                <Td>{TYPE_LABELS[row.orderType]}</Td>
                <Td>
                  <span
                    className="block max-w-[220px] truncate"
                    title={row.productSummary}
                  >
                    {row.productSummary || "N/A"}
                  </span>
                </Td>
                <Td>{row.quantity}</Td>
                <Td>{formatPeso(row.totalAmount)}</Td>
                <Td>{row.dateNeeded ?? "N/A"}</Td>
                <Td>
                  <StatusBadge status={row.status} />
                </Td>
                <Td>
                  {row.source === "HISTORICAL_IMPORT" ? (
                    <HistoricalImportBadge />
                  ) : (
                    <span className="text-dacs-muted">Live</span>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center justify-center gap-2">
                    {row.status === "PENDING" && (
                      <>
                        <button
                          type="button"
                          aria-label="Approve order"
                          disabled={deciding === row.id}
                          onClick={() => void decide(row, "APPROVED")}
                          className="rounded-full bg-green-100 p-1.5 text-green-700 hover:bg-green-200 disabled:opacity-50"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="Reject order"
                          disabled={deciding === row.id}
                          onClick={() => void decide(row, "REJECTED")}
                          className="rounded-full bg-red-100 p-1.5 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        >
                          <X size={16} />
                        </button>
                        {/* Seminar orders sell fixed module access at the
                            checkout-time price — no quotation to edit. */}
                        {row.orderType !== "SEMINAR" && (
                          <button
                            type="button"
                            aria-label="Edit order"
                            onClick={() => setEditing(row)}
                            className="rounded-full bg-blue-100 p-1.5 text-blue-700 hover:bg-blue-200"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                      </>
                    )}
                    {row.source === "LIVE" &&
                      (row.status === "APPROVED" ||
                        row.status === "PAYMENT_SUBMITTED") && (
                        <button
                          type="button"
                          aria-label="Record payment"
                          title="Record payment (proof received by email)"
                          onClick={() => setRecordingFor(row)}
                          className="rounded-full bg-amber-100 p-1.5 text-amber-700 hover:bg-amber-200"
                        >
                          <Banknote size={16} />
                        </button>
                      )}
                    <button
                      type="button"
                      aria-label="View quotation"
                      onClick={() => viewOrder(row)}
                      className="rounded-full bg-dacs-light p-1.5 text-dacs-dark hover:bg-gray-200"
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          {!loading && !loadError && paged.length === 0 && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={11}>
                No orders match the current search/filter.
              </Td>
            </tr>
          )}
        </tbody>
      </TableShell>

      <Pagination page={page} total={filtered.length} onPageChange={setPage} />

      {viewing && (
        <QuotationModal
          order={viewing}
          detail={
            viewingDetail && viewingDetail.id === viewing.id
              ? viewingDetail
              : null
          }
          onClose={() => {
            setViewing(null);
            setViewingDetail(null);
          }}
        />
      )}
      {editing && (
        <EditOrderModal
          order={editing}
          onSave={(updated) => void saveEdit(updated)}
          onCancel={() => setEditing(null)}
        />
      )}
      {recordingFor && (
        <RecordPaymentModal
          order={recordingFor}
          onRecorded={(summary) => {
            setRecordingFor(null);
            appendAudit(
              "Payments",
              "PAYMENT_RECORDED",
              `Recorded a payment for order ${recordingFor.orderNumber}.`
            );
            showToast(summary);
            /* The order's status likely changed — pull fresh rows now
               instead of waiting for the next poll. */
            void load("refresh");
          }}
          onCancel={() => setRecordingFor(null)}
        />
      )}
    </>
  );
}
