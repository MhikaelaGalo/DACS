"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileSpreadsheet, RefreshCw } from "lucide-react";

import { HistoricalRecordsTable } from "@/components/historical/HistoricalRecords";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  getHistoricalFile,
  reimportHistoricalFile,
  type ApiHistoricalFile,
} from "@/lib/api/historical";
import { appendAudit } from "@/lib/audit";
import { formatDate } from "@/lib/format";

/*
 * Historical Data — imported workbook detail. One tab per source sheet;
 * each tab is a searchable, server-paginated table of the preserved
 * historical records (historical_source_records) with a full-record
 * detail modal. "Re-import" re-runs the import from the stored copy —
 * idempotent, used to backfill files imported before the lossless
 * layer existed.
 */

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

export default function HistoricalFileDetailPage() {
  const params = useParams<{ fileId: string }>();
  const fileId = params.fileId;
  const { showToast } = useToast();

  const [file, setFile] = useState<ApiHistoricalFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [confirmingReimport, setConfirmingReimport] = useState(false);
  const [reimporting, setReimporting] = useState(false);
  /* Bumps the table key so it refetches after a re-import. */
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await getHistoricalFile(fileId);
      setFile(data);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        errorMessage(error, "Unable to load this historical file. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* One tab per distinct source sheet (a file re-imported twice has two
     runs per sheet — the tab groups them). */
  const sheets = useMemo(() => {
    const bySheet = new Map<
      string,
      { sheetName: string; records: number; errors: number }
    >();
    for (const run of file?.imports ?? []) {
      const entry = bySheet.get(run.sheetName) ?? {
        sheetName: run.sheetName,
        records: 0,
        errors: 0,
      };
      entry.records += run._count?.sourceRecords ?? 0;
      entry.errors += run._count?.errors ?? 0;
      bySheet.set(run.sheetName, entry);
    }
    return [...bySheet.values()];
  }, [file]);

  /* Normalized orders produced by this workbook (orders sheets only). */
  const orderTotals = useMemo(
    () =>
      (file?.imports ?? []).reduce(
        (accumulator, run) => ({
          orders: accumulator.orders + (run.ordersCreated ?? 0),
          items: accumulator.items + (run.orderItemsCreated ?? 0),
          payments: accumulator.payments + (run.paymentsCreated ?? 0),
        }),
        { orders: 0, items: 0, payments: 0 }
      ),
    [file]
  );

  useEffect(() => {
    if (!activeSheet && sheets.length > 0) setActiveSheet(sheets[0].sheetName);
  }, [sheets, activeSheet]);

  async function runReimport() {
    setReimporting(true);
    try {
      const result = await reimportHistoricalFile(fileId);
      const totals = result.data.imports.reduce(
        (accumulator, sheet) => ({
          records: accumulator.records + sheet.sourceRecordsCreated,
          duplicates: accumulator.duplicates + sheet.duplicateRows,
          orders: accumulator.orders + (sheet.ordersCreated ?? 0),
        }),
        { records: 0, duplicates: 0, orders: 0 }
      );
      appendAudit(
        "Historical",
        "HISTORICAL_FILE_REIMPORTED",
        `Re-imported ${file?.originalName ?? "historical file"} from its stored copy.`
      );
      showToast(
        totals.records > 0
          ? `Re-import complete — ${totals.records} historical record(s)${
              totals.orders > 0 ? ` and ${totals.orders} order(s)` : ""
            } added.`
          : `Re-import complete — all ${totals.duplicates} row(s) were already imported.`
      );
      setRefreshToken((current) => current + 1);
      await load();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to re-import this file. Please try again."),
        "error"
      );
    } finally {
      setReimporting(false);
      setConfirmingReimport(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/historical"
            aria-label="Back to Historical Data"
            className="rounded-full p-2 text-dacs-dark hover:bg-dacs-light"
          >
            <ArrowLeft size={22} />
          </Link>
          <FileSpreadsheet size={26} className="shrink-0 text-green-700" />
          <h1 className="min-w-0 truncate text-xl font-bold leading-tight sm:text-2xl lg:text-[28px]">
            {file?.originalName ?? "Historical File"}
          </h1>
        </div>

        {file && (
          <div className="flex items-center gap-3">
            <a
              href={file.storageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-2xl border border-dacs-dark/40 px-5 py-2.5 font-semibold hover:bg-dacs-light/50"
            >
              <Download size={16} />
              Download
            </a>
            <button
              type="button"
              disabled={reimporting}
              onClick={() => setConfirmingReimport(true)}
              className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={16} className={reimporting ? "animate-spin" : ""} />
              {reimporting ? "Re-importing…" : "Re-import"}
            </button>
          </div>
        )}
      </div>

      {loading && (
        <p className="py-16 text-center text-sm text-dacs-muted">
          Loading historical file…
        </p>
      )}

      {!loading && loadError && (
        <div className="flex flex-col items-center gap-3 rounded-dacs-card border border-dashed border-dacs-dark/30 py-16 text-center">
          <p className="text-dacs-muted">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
          >
            Try Again
          </button>
        </div>
      )}

      {!loading && !loadError && file && (
        <>
          <div className="mb-6 flex flex-wrap gap-x-8 gap-y-1 text-sm text-dacs-muted">
            <span>Uploaded {formatDate(file.createdAt)}</span>
            <span>{formatSize(file.sizeBytes)}</span>
            {file.category && <span>Folder: {file.category}</span>}
            {file.year && <span>Year: {file.year}</span>}
            {file.uploadedBy?.email && <span>By {file.uploadedBy.email}</span>}
            {orderTotals.orders > 0 && (
              <span className="font-medium text-dacs-dark">
                {`${orderTotals.orders} orders · ${orderTotals.items} order items · ${orderTotals.payments} payment summaries imported — visible in Customer Information & Order Tracking`}
              </span>
            )}
          </div>

          {sheets.length === 0 && (
            <div className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-16 text-center text-dacs-muted">
              <p className="font-semibold">
                No historical records are linked to this file yet.
              </p>
              <p className="mx-auto mt-1 max-w-[520px] text-sm">
                If this workbook was imported before record preservation was
                added, click “Re-import” above to backfill its rows — existing
                customers and farms are matched, never duplicated.
              </p>
            </div>
          )}

          {sheets.length > 0 && (
            <>
              {/* ---- Sheet tabs ---- */}
              <div className="mb-5 flex flex-wrap gap-2 border-b border-dacs-light">
                {sheets.map((sheet) => (
                  <button
                    key={sheet.sheetName}
                    type="button"
                    onClick={() => setActiveSheet(sheet.sheetName)}
                    className={`-mb-px rounded-t-xl border-b-2 px-5 py-2.5 font-semibold transition-colors ${
                      activeSheet === sheet.sheetName
                        ? "border-dacs-red text-dacs-dark"
                        : "border-transparent text-dacs-muted hover:text-dacs-dark"
                    }`}
                  >
                    {sheet.sheetName}
                    <span className="ml-2 rounded-full bg-dacs-light px-2 py-0.5 text-xs font-medium text-dacs-muted">
                      {sheet.records}
                    </span>
                  </button>
                ))}
              </div>

              {activeSheet && (
                <HistoricalRecordsTable
                  key={`${activeSheet}-${refreshToken}`}
                  historicalFileId={fileId}
                  sheetName={activeSheet}
                  searchPlaceholder={`Search ${activeSheet}...`}
                />
              )}
            </>
          )}
        </>
      )}

      {confirmingReimport && (
        <ConfirmDialog
          message="Re-import this workbook?"
          detail="The stored copy is processed again with the current importer. Rows already imported are skipped — existing customers, DAPG numbers and farms are never duplicated."
          confirmLabel={reimporting ? "Re-importing…" : "Yes, Re-import"}
          onConfirm={() => {
            if (!reimporting) void runReimport();
          }}
          onCancel={() => {
            if (!reimporting) setConfirmingReimport(false);
          }}
        />
      )}
    </>
  );
}
