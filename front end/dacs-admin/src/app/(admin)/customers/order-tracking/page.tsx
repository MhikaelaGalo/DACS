"use client";

import { useCallback, useState } from "react";

import { HistoricalImportBadge } from "@/components/historical/HistoricalRecords";
import { AdminHeader } from "@/components/layout/AdminHeader";
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
  listOrders,
  paymentDatesByOrder,
  toOrderTrackingRow,
} from "@/lib/api/orders";
import { listPayments } from "@/lib/api/payments";
import { useAutoRefresh, type LoadMode } from "@/lib/useAutoRefresh";
import { formatPeso, formatSlashDate } from "@/lib/format";
import type { OrderTrackingRow } from "@/types/admin";

const COLUMNS: Array<TableColumn<OrderTrackingRow>> = [
  { key: "customerNumber", label: "Customer ID #", get: (row) => row.customerNumber },
  { key: "name", label: "Name", get: (row) => row.name },
  { key: "address", label: "Address", get: (row) => row.address },
  { key: "contactNumber", label: "Contact #", get: (row) => row.contactNumber },
  { key: "email", label: "Email", get: (row) => row.email },
  { key: "facebookName", label: "Facebook", get: (row) => row.facebookName },
  { key: "receiverName", label: "Receiver Name", get: (row) => row.receiverName },
  { key: "quantity", label: "Amount", get: (row) => row.quantity },
  { key: "totalAmount", label: "Price", get: (row) => row.totalAmount },
  { key: "trackingStatus", label: "Status", get: (row) => row.trackingStatus },
  {
    key: "source",
    label: "Source",
    get: (row) => (row.source === "HISTORICAL_IMPORT" ? "Historical Import" : "Live"),
  },
];

/*
 * Customer Order Tracking — the Figma's wide table: customer columns,
 * receiver columns, logistics and the Processing/Shipped/Delivered
 * status. Horizontal scroll lives inside the table shell.
 *
 * Data source: staff GET /api/orders (fulfillment-stage statuses only)
 * joined with verified payments for the Pay Date column.
 */
export default function OrderTrackingPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<TableQuery>(emptyQuery("customerNumber"));
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<OrderTrackingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (mode: LoadMode) => {
    try {
      const [orders, payments] = await Promise.all([
        listOrders(),
        listPayments("VERIFIED"),
      ]);
      const payDates = paymentDatesByOrder(payments);
      setRows(
        orders
          .map((order) => toOrderTrackingRow(order, payDates))
          .filter((row): row is OrderTrackingRow => row !== null)
      );
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

  /* Status changes and payment verifications can happen elsewhere. */
  useAutoRefresh(load, 10_000);

  const searched = rows.filter((row) =>
    `${row.customerNumber} ${row.name} ${row.receiverName} ${row.trackingStatus}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const filtered = applyQuery(searched, COLUMNS, query);
  const paged = pageSlice(filtered, page);

  return (
    <>
      <AdminHeader
        title="Customer Order Tracking"
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
            <Th>Address</Th>
            <Th>Contact #</Th>
            <Th>Email</Th>
            <Th>Facebook</Th>
            <Th>Receiver Name</Th>
            <Th>Receiver Facebook</Th>
            <Th>Receiver Contact #</Th>
            <Th>Amount</Th>
            <Th>Price</Th>
            <Th>Hatch Date</Th>
            <Th>Airport Loc.</Th>
            <Th>Pay Date</Th>
            <Th>Status</Th>
            <Th>Source</Th>
            <Th>Instructions</Th>
            <Th>Transportation Shipping Cost Payment</Th>
            <Th>Pick-Up at LBC Branch</Th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={19}>
                Loading orders…
              </Td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={19}>
                {loadError}
              </Td>
            </tr>
          )}
          {!loading &&
            !loadError &&
            paged.map((row) => (
              <tr key={row.id}>
                <Td>{row.customerNumber}</Td>
                <Td className="font-semibold text-dacs-red">{row.name}</Td>
                <Td>{row.address}</Td>
                <Td>{row.contactNumber}</Td>
                <Td>{row.email}</Td>
                <Td>{row.facebookName}</Td>
                <Td className="font-semibold">{row.receiverName}</Td>
                <Td>{row.receiverFacebook}</Td>
                <Td>{row.receiverContact}</Td>
                <Td>{row.quantity}</Td>
                <Td>{formatPeso(row.totalAmount)}</Td>
                <Td>{row.hatchDate ? formatSlashDate(row.hatchDate) : "N/A"}</Td>
                <Td>{row.airportLocation ?? "N/A"}</Td>
                <Td>{row.paymentDate ? formatSlashDate(row.paymentDate) : "N/A"}</Td>
                <Td>
                  <StatusBadge status={row.trackingStatus} />
                </Td>
                <Td>
                  {row.source === "HISTORICAL_IMPORT" ? (
                    <HistoricalImportBadge />
                  ) : (
                    <span className="text-dacs-muted">Live</span>
                  )}
                </Td>
                <Td>{row.instructions ?? "N/A"}</Td>
                <Td>{formatPeso(row.feeTotal)}</Td>
                <Td>{row.pickupBranch ?? "N/A"}</Td>
              </tr>
            ))}
          {!loading && !loadError && paged.length === 0 && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={19}>
                No orders match the current search/filter.
              </Td>
            </tr>
          )}
        </tbody>
      </TableShell>

      <Pagination page={page} total={filtered.length} onPageChange={setPage} />
    </>
  );
}
