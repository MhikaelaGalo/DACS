"use client";

import { useCallback, useState } from "react";

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
import { listTicketRows } from "@/lib/api/inquiries";
import { useAutoRefresh, type LoadMode } from "@/lib/useAutoRefresh";
import type { TicketRow } from "@/types/admin";

const COLUMNS: Array<TableColumn<TicketRow>> = [
  { key: "customerNumber", label: "Customer ID #", get: (row) => row.customerNumber },
  { key: "name", label: "Name", get: (row) => row.name },
  { key: "address", label: "Address", get: (row) => row.address },
  { key: "contactNumber", label: "Contact #", get: (row) => row.contactNumber },
  { key: "email", label: "Email", get: (row) => row.email },
  { key: "facebookName", label: "Facebook", get: (row) => row.facebookName },
  { key: "ticketNumber", label: "Ticket #", get: (row) => row.ticketNumber },
  { key: "subject", label: "Subject", get: (row) => row.subject },
  { key: "category", label: "Category", get: (row) => row.category },
  { key: "priority", label: "Priority", get: (row) => row.priority },
  { key: "status", label: "Status", get: (row) => row.status },
  { key: "createdAt", label: "Submitted", get: (row) => row.createdAt },
];

/*
 * Customer Ticket Monitoring — data source: staff GET /api/inquiries
 * (latest 100 tickets; search/filter stay client-side).
 */
export default function TicketMonitoringPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<TableQuery>(emptyQuery("customerNumber"));
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (mode: LoadMode) => {
    try {
      setRows(await listTicketRows());
      setLoadError(null);
    } catch (error) {
      /* Background refreshes keep the last good rows; the next tick retries. */
      if (mode === "initial") {
        setLoadError(errorMessage(error, "Unable to load tickets. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /* Farmers file tickets from the customer site while this page is open. */
  useAutoRefresh(load, 10_000);

  const searched = rows.filter((row) =>
    `${row.customerNumber} ${row.name} ${row.ticketNumber} ${row.subject}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const filtered = applyQuery(searched, COLUMNS, query);
  const paged = pageSlice(filtered, page);

  return (
    <>
      <AdminHeader
        title="Customer Ticket Monitoring"
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
            <Th>Ticket #</Th>
            <Th>Subject</Th>
            <Th>Category</Th>
            <Th>Priority</Th>
            <Th>Status</Th>
            <Th>Submitted</Th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={12}>
                Loading tickets…
              </Td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={12}>
                {loadError}
              </Td>
            </tr>
          )}
          {!loading && !loadError && paged.map((row) => (
            <tr key={row.ticketNumber}>
              <Td>{row.customerNumber}</Td>
              <Td className="font-semibold text-dacs-red">{row.name}</Td>
              <Td>{row.address}</Td>
              <Td>{row.contactNumber}</Td>
              <Td>{row.email}</Td>
              <Td>{row.facebookName}</Td>
              <Td>{row.ticketNumber}</Td>
              <Td>{row.subject}</Td>
              <Td>{row.category ?? "N/A"}</Td>
              <Td>{row.priority ?? "N/A"}</Td>
              <Td>
                <StatusBadge status={row.status} />
              </Td>
              <Td>{row.createdAt}</Td>
            </tr>
          ))}
          {!loading && !loadError && paged.length === 0 && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={12}>
                No tickets match the current search/filter.
              </Td>
            </tr>
          )}
        </tbody>
      </TableShell>

      <Pagination page={page} total={filtered.length} onPageChange={setPage} />
    </>
  );
}
