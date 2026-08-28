"use client";

import { useCallback, useState } from "react";

import { AdminHeader } from "@/components/layout/AdminHeader";
import {
  HistoricalImportBadge,
  HistoricalRecordsTable,
} from "@/components/historical/HistoricalRecords";
import {
  applyQuery,
  emptyQuery,
  FilterButton,
  type TableColumn,
  type TableQuery,
} from "@/components/ui/FilterControls";
import { ImageModal } from "@/components/ui/Modal";
import { pageSlice, Pagination, TableShell, Td, Th } from "@/components/ui/Table";
import { errorMessage } from "@/lib/api";
import { listBreederRows } from "@/lib/api/breeders";
import { useAutoRefresh, type LoadMode } from "@/lib/useAutoRefresh";
import { formatSlashDate } from "@/lib/format";
import type { BreederMonitoringRow } from "@/types/admin";

const COLUMNS: Array<TableColumn<BreederMonitoringRow>> = [
  { key: "customerNumber", label: "Customer ID #", get: (row) => row.customerNumber },
  { key: "name", label: "Name", get: (row) => row.name },
  { key: "address", label: "Address", get: (row) => row.address },
  { key: "contactNumber", label: "Contact #", get: (row) => row.contactNumber },
  { key: "email", label: "Email", get: (row) => row.email },
  { key: "facebookName", label: "Facebook", get: (row) => row.facebookName },
  { key: "farmName", label: "Farm Name", get: (row) => row.farmName },
  { key: "farmAddress", label: "Farm Address", get: (row) => row.farmAddress },
  { key: "breederDate", label: "Date of Breeders", get: (row) => row.breederDate },
  { key: "numberAlive", label: "# of Alive", get: (row) => row.numberAlive },
  {
    key: "vaccinationRecords",
    label: "Records of Vaccination",
    get: (row) => row.vaccinationRecords,
  },
  {
    key: "feedingHealthWeight",
    label: "Feeding, Health, Weight Management",
    get: (row) => row.feedingHealthWeight,
  },
  {
    key: "breedersClaimed",
    label: "# of Breeders Claimed",
    get: (row) => row.breedersClaimed,
  },
];

/*
 * Customer Breeder Monitoring — Figma wide table ending in the Farm
 * Logo column whose red "View Image" link opens the logo modal.
 */
export default function BreederMonitoringPage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<TableQuery>(emptyQuery("customerNumber"));
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<BreederMonitoringRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewingLogo, setViewingLogo] = useState<BreederMonitoringRow | null>(
    null
  );
  /* "live" = monitoring cycles from released DACS Parent Stock orders;
     "historical" = imported legacy PS reports (no fabricated orders). */
  const [view, setView] = useState<"live" | "historical">("live");

  const load = useCallback(async (mode: LoadMode) => {
    try {
      setRows(await listBreederRows());
      setLoadError(null);
    } catch (error) {
      /* Background refreshes keep the last good rows; the next tick retries. */
      if (mode === "initial") {
        setLoadError(
          errorMessage(error, "Unable to load breeder records. Please try again.")
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /* Farmers update monitoring reports from the customer site. */
  useAutoRefresh(load, 30_000);

  const searched = rows.filter((row) =>
    `${row.customerNumber} ${row.name} ${row.farmName}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const filtered = applyQuery(searched, COLUMNS, query);
  const paged = pageSlice(filtered, page);

  return (
    <>
      <AdminHeader
        title="Customer Breeder Monitoring"
        search={view === "live" ? { value: search, onChange: setSearch } : undefined}
        right={
          view === "live" ? (
            <FilterButton
              rows={rows}
              columns={COLUMNS}
              query={query}
              onChange={setQuery}
            />
          ) : undefined
        }
      />

      {/* Live monitoring cycles vs. imported legacy PS reports. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setView("live")}
          className={`rounded-full px-5 py-2 font-semibold transition-colors ${
            view === "live"
              ? "bg-dacs-dark text-white"
              : "border border-dacs-dark/30 text-dacs-muted hover:text-dacs-dark"
          }`}
        >
          Live Monitoring
        </button>
        <button
          type="button"
          onClick={() => setView("historical")}
          className={`rounded-full px-5 py-2 font-semibold transition-colors ${
            view === "historical"
              ? "bg-dacs-dark text-white"
              : "border border-dacs-dark/30 text-dacs-muted hover:text-dacs-dark"
          }`}
        >
          Historical Records
        </button>
        {view === "historical" && (
          <span className="ml-2 flex flex-wrap items-center gap-2 text-sm text-dacs-muted">
            <HistoricalImportBadge label="Historical Record" />
            Imported legacy Parent Stock reports — not tied to a DACS order or
            release.
          </span>
        )}
      </div>

      {view === "historical" && (
        <HistoricalRecordsTable
          recordType="PARENT_STOCK"
          searchPlaceholder="Search historical PS records..."
        />
      )}

      {view === "live" && (
      <TableShell>
        <thead>
          <tr>
            <Th>Customer ID #</Th>
            <Th>Name</Th>
            <Th>Address</Th>
            <Th>Contact #</Th>
            <Th>Email</Th>
            <Th>Facebook</Th>
            <Th>Farm Name</Th>
            <Th>Farm Address</Th>
            <Th>Date of Breeders</Th>
            <Th># of Alive</Th>
            <Th>Records of Vaccination</Th>
            <Th>Feeding, Health, Weight Management</Th>
            <Th># of Breeders Claimed</Th>
            <Th>Farm Logo</Th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={14}>
                Loading breeder records…
              </Td>
            </tr>
          )}
          {!loading && loadError && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={14}>
                {loadError}
              </Td>
            </tr>
          )}
          {!loading && !loadError && paged.map((row) => (
            <tr key={row.id ?? row.customerNumber}>
              <Td>{row.customerNumber}</Td>
              <Td className="font-semibold text-dacs-red">{row.name}</Td>
              <Td>{row.address}</Td>
              <Td>{row.contactNumber}</Td>
              <Td>{row.email}</Td>
              <Td>{row.facebookName}</Td>
              <Td>{row.farmName}</Td>
              <Td>{row.farmAddress}</Td>
              <Td>{row.breederDate ? formatSlashDate(row.breederDate) : "N/A"}</Td>
              <Td className="font-semibold">{row.numberAlive ?? "N/A"}</Td>
              <Td>{row.vaccinationRecords ?? "N/A"}</Td>
              <Td>{row.feedingHealthWeight ?? "N/A"}</Td>
              <Td className="font-semibold">{row.breedersClaimed ?? "N/A"}</Td>
              <Td>
                <button
                  type="button"
                  onClick={() => setViewingLogo(row)}
                  className="font-semibold text-dacs-red underline hover:opacity-80"
                >
                  View Image
                </button>
              </Td>
            </tr>
          ))}
          {!loading && !loadError && paged.length === 0 && (
            <tr>
              <Td className="py-10 text-dacs-muted" colSpan={14}>
                No breeders match the current search/filter.
              </Td>
            </tr>
          )}
        </tbody>
      </TableShell>
      )}

      {view === "live" && (
        <Pagination page={page} total={filtered.length} onPageChange={setPage} />
      )}

      {viewingLogo && (
        <ImageModal
          src={viewingLogo.farmLogo}
          alt={`${viewingLogo.farmName} logo`}
          onClose={() => setViewingLogo(null)}
        />
      )}
    </>
  );
}
