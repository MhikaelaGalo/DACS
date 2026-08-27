"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import {
  applyQuery,
  emptyQuery,
  FilterButton,
  type TableColumn,
  type TableQuery,
} from "@/components/ui/FilterControls";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  deleteHistoricalFile,
  listHistoricalFiles,
  uploadHistoricalFile,
  type ApiHistoricalFile,
} from "@/lib/api/historical";
import { errorMessage } from "@/lib/api";
import { appendAudit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { HistoricalFileRow } from "@/types/admin";

/*
 * Historical Data file manager (Figma): search + funnel + trash +
 * Upload File; rows have selection checkboxes, expandable folders and
 * per-row downloads. Clicking a file name opens a Google Drive-style
 * in-page preview (PDF/images/CSV/plain text) instead of navigating
 * away; formats the browser can't render fall back to a download
 * prompt.
 *
 * Data source: the DACS backend (GET/POST/DELETE /api/historical/files;
 * upload also runs the spreadsheet import). Folders are a UI grouping
 * of the backend's free-text `category` field — rows whose category
 * matches are nested under a synthetic folder row.
 */

const COLUMNS: Array<TableColumn<HistoricalFileRow>> = [
  { key: "originalName", label: "Name", get: (row) => row.originalName },
  { key: "createdAt", label: "Modified", get: (row) => row.createdAt },
  { key: "sizeBytes", label: "Size", get: (row) => row.sizeBytes },
  { key: "category", label: "Folder", get: (row) => row.category },
];

type PreviewKind = "pdf" | "image" | "csv" | "text" | "unsupported";

function previewKind(name: string): PreviewKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (ext === "csv") return "csv";
  if (["txt", "log", "md", "json"].includes(ext)) return "text";
  return "unsupported";
}

function contentUrlFor(row: HistoricalFileRow): string | null {
  return row.storageUrl ?? null;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

function toRow(file: ApiHistoricalFile): HistoricalFileRow {
  return {
    id: file.id,
    originalName: file.originalName,
    category: file.category,
    year: file.year,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    itemCount: null,
    kind: file.originalName.toLowerCase().endsWith(".pdf") ? "pdf" : "xlsx",
    storageUrl: file.storageUrl,
  };
}

/* Files sharing a category nest under one synthetic folder row. */
function withFolders(files: HistoricalFileRow[]): HistoricalFileRow[] {
  const byCategory = new Map<string, HistoricalFileRow[]>();
  for (const file of files) {
    if (!file.category) continue;
    const group = byCategory.get(file.category) ?? [];
    group.push(file);
    byCategory.set(file.category, group);
  }
  const folders: HistoricalFileRow[] = [...byCategory.entries()].map(
    ([category, children]) => ({
      id: `folder-${category}`,
      originalName: category,
      category,
      year: null,
      sizeBytes: 0,
      createdAt: children.reduce(
        (latest, child) => (child.createdAt > latest ? child.createdAt : latest),
        children[0].createdAt
      ),
      itemCount: children.length,
    })
  );
  return [...folders, ...files];
}

function FileIcon({ row, size = 18 }: { row: HistoricalFileRow; size?: number }) {
  const kind = previewKind(row.originalName);
  if (row.kind === "pdf" || kind === "pdf" || kind === "image" || kind === "text") {
    return <FileText size={size} className="text-red-600" />;
  }
  return <FileSpreadsheet size={size} className="text-green-700" />;
}

/* Preview body: renders what the browser can, falls back otherwise. */
function PreviewBody({
  row,
  url,
  onDownload,
}: {
  row: HistoricalFileRow;
  url: string | null;
  onDownload: () => void;
}) {
  const kind = previewKind(row.originalName);
  const [text, setText] = useState<string | null>(null);
  const [textFailed, setTextFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setTextFailed(false);
    if (url && (kind === "csv" || kind === "text")) {
      fetch(url)
        .then((response) => response.text())
        .then((content) => {
          if (!cancelled) setText(content);
        })
        .catch(() => {
          if (!cancelled) setTextFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [row.id, url, kind]);

  if (url && kind === "pdf") {
    return (
      <iframe
        src={url}
        title={row.originalName}
        className="h-[62vh] w-full rounded-lg border border-dacs-light bg-dacs-light/40"
      />
    );
  }

  if (url && kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={row.originalName}
        className="mx-auto max-h-[62vh] max-w-full rounded-lg object-contain"
      />
    );
  }

  if (url && kind === "csv" && text !== null) {
    const rows = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .slice(0, 200)
      .map((line) => line.split(","));
    return (
      <div className="max-h-[62vh] overflow-auto rounded-lg border border-dacs-light">
        <table className="w-full min-w-max border-collapse text-sm">
          <tbody>
            {rows.map((cells, rowIndex) => (
              <tr key={rowIndex} className={rowIndex === 0 ? "bg-dacs-light/70 font-semibold" : ""}>
                {cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="border-b border-dacs-light px-3 py-2"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (url && kind === "text" && text !== null) {
    return (
      <pre className="max-h-[62vh] overflow-auto whitespace-pre-wrap rounded-lg border border-dacs-light bg-dacs-light/30 p-4 text-sm">
        {text}
      </pre>
    );
  }

  if (url && (kind === "csv" || kind === "text") && !textFailed) {
    return (
      <p className="py-16 text-center text-sm text-dacs-muted">Loading preview…</p>
    );
  }

  /* No stored content, an unsupported format, or a failed read. */
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-dacs-dark/30 px-6 py-14 text-center">
      <FileIcon row={row} size={40} />
      <p className="font-semibold">
        {url
          ? "Preview is not available for this file type."
          : "Preview is not available for this file."}
      </p>
      <p className="max-w-[420px] text-sm text-dacs-muted">
        {url
          ? "The browser can't display this format — download it to view the contents."
          : "This record has no stored copy — the download generates a summary instead."}
      </p>
      <button
        type="button"
        onClick={onDownload}
        className="mt-2 flex items-center gap-2 rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
      >
        <Download size={16} />
        Download File
      </button>
    </div>
  );
}

export default function HistoricalDataPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<TableQuery>(emptyQuery("originalName"));
  const [rows, setRows] = useState<HistoricalFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewFile, setPreviewFile] = useState<HistoricalFileRow | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const files = await listHistoricalFiles();
      setRows(withFolders(files.map(toRow)));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        errorMessage(error, "Unable to load historical files. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.historical);
    void refresh();
  }, [refresh]);

  const folders = rows.filter((row) => row.itemCount !== null);
  const files = rows.filter((row) => row.itemCount === null);

  const matches = (row: HistoricalFileRow) =>
    row.originalName.toLowerCase().includes(search.toLowerCase()) &&
    applyQuery([row], COLUMNS, query).length > 0;

  const looseFiles = files.filter(
    (file) =>
      (file.category === null ||
        !folders.some((folder) => folder.category === file.category)) &&
      matches(file)
  );

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function toggleSelected(id: string) {
    setSelected((current) => ({ ...current, [id]: !current[id] }));
  }

  async function deleteSelected() {
    /* Deleting a folder deletes the files grouped under it. */
    const doomedCategories = rows
      .filter((row) => selectedIds.includes(row.id) && row.itemCount !== null)
      .map((row) => row.category);
    const doomedFiles = files.filter(
      (file) =>
        selectedIds.includes(file.id) ||
        (file.category !== null && doomedCategories.includes(file.category))
    );
    const names = rows
      .filter((row) => selectedIds.includes(row.id))
      .map((row) => row.originalName);

    setDeleting(true);
    try {
      const outcomes = await Promise.allSettled(
        doomedFiles.map((file) => deleteHistoricalFile(file.id))
      );
      const failures = outcomes.filter(
        (outcome) => outcome.status === "rejected"
      ) as PromiseRejectedResult[];

      if (failures.length === 0) {
        appendAudit(
          "Historical",
          "HISTORICAL_FILE_DELETED",
          `Removed ${names.length} item(s): ${names.join(", ")}.`
        );
        showToast(
          names.length === 1
            ? "File deleted successfully."
            : `${names.length} items deleted successfully.`
        );
      } else {
        showToast(
          errorMessage(
            failures[0].reason,
            "Unable to delete the selected files. Please try again."
          ),
          "error"
        );
      }
      setSelected({});
      await refresh();
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function handleUpload(file: File) {
    // The backend importer only accepts .xlsx workbooks (validated by
    // magic bytes server-side). Reject anything else up front so the
    // message is clear instead of a generic server rejection.
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      showToast(
        "Only .xlsx spreadsheets can be imported. Please upload an Excel .xlsx file.",
        "error"
      );
      return;
    }
    setUploading(true);
    try {
      const result = await uploadHistoricalFile(file);
      const customers = result.data.imports.reduce(
        (total, sheet) => total + sheet.customersCreated,
        0
      );
      const records = result.data.imports.reduce(
        (total, sheet) => total + (sheet.sourceRecordsCreated ?? 0),
        0
      );
      const orders = result.data.imports.reduce(
        (total, sheet) => total + (sheet.ordersCreated ?? 0),
        0
      );
      appendAudit(
        "Historical",
        "HISTORICAL_FILE_UPLOADED",
        `Uploaded ${file.name} (${formatSize(file.size)}).`
      );
      showToast(
        records > 0
          ? `File uploaded — ${records} historical record(s) preserved, ${
              orders > 0
                ? `${orders} order(s) imported`
                : `${customers} customer(s) created`
            }.`
          : "File uploaded successfully."
      );
      await refresh();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to upload the file. Please try again."),
        "error"
      );
    } finally {
      setUploading(false);
    }
  }

  async function downloadRow(row: HistoricalFileRow) {
    /*
     * Server-backed rows stream the stored file (fetched as a blob so
     * the browser saves it under its original name); synthetic folder
     * rows generate a small CSV summary instead.
     */
    const contentUrl = contentUrlFor(row);
    if (contentUrl) {
      try {
        const response = await fetch(contentUrl);
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = row.originalName;
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch {
        showToast("Unable to download this file. Please try again.", "error");
      }
      return;
    }
    const content =
      row.itemCount !== null
        ? `Folder,${row.originalName}\nItems,${row.itemCount}\n`
        : `File,${row.originalName}\nModified,${row.createdAt}\nSize,${formatSize(row.sizeBytes)}\n`;
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = row.originalName.replace(/\.(xlsx|pdf)$/i, "") + ".csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openInNewTab(row: HistoricalFileRow) {
    const url = contentUrlFor(row);
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  const grid = "grid grid-cols-[44px_1fr_180px_120px_60px] items-center";

  function FileRow({ file, indent }: { file: HistoricalFileRow; indent?: boolean }) {
    /* Imported workbooks open their record view (per-sheet tabs of the
       preserved historical rows); other formats keep the in-page
       preview. */
    const opensRecords = file.kind === "xlsx";
    return (
      <div className={`${grid} border-b border-dacs-light px-5 py-3`}>
        <input
          type="checkbox"
          aria-label={`Select ${file.originalName}`}
          checked={!!selected[file.id]}
          onChange={() => toggleSelected(file.id)}
          className="h-4 w-4 accent-dacs-red"
        />
        <button
          type="button"
          onClick={() =>
            opensRecords
              ? router.push(`/historical/${file.id}`)
              : setPreviewFile(file)
          }
          className={`flex min-w-0 items-center gap-3 text-left hover:underline ${indent ? "pl-10" : ""}`}
          title={
            opensRecords
              ? `Open the imported records of ${file.originalName}`
              : `Preview ${file.originalName}`
          }
        >
          <FileIcon row={file} />
          <span className="truncate">{file.originalName}</span>
        </button>
        <span>{formatDate(file.createdAt)}</span>
        <span>{formatSize(file.sizeBytes)}</span>
        <button
          type="button"
          aria-label={`Download ${file.originalName}`}
          onClick={() => void downloadRow(file)}
          className="text-dacs-muted hover:text-dacs-dark"
        >
          <Download size={18} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3 lg:mb-8 lg:gap-6">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Historical Data</h1>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:gap-6">
        <div className="relative min-w-[200px] max-w-[560px] flex-1">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Data..."
            className="w-full rounded-full border border-dacs-dark/40 py-3 pl-6 pr-12 text-sm italic outline-none focus:border-dacs-dark"
          />
          <Search
            size={18}
            className="absolute right-5 top-1/2 -translate-y-1/2 text-dacs-dark"
          />
        </div>
        <div className="flex items-center gap-3">
          <FilterButton
            rows={rows}
            columns={COLUMNS}
            query={query}
            onChange={setQuery}
          />
          <button
            type="button"
            aria-label="Delete selected files"
            disabled={selectedIds.length === 0 || deleting}
            onClick={() => setConfirmingDelete(true)}
            className="rounded-full p-2 text-dacs-dark hover:bg-dacs-light disabled:opacity-30"
          >
            <Trash2 size={22} />
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => uploadInput.current?.click()}
            className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-7 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            <Upload size={18} />
            {uploading ? "Uploading…" : "Upload File"}
          </button>
          <input
            ref={uploadInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg"><div className="min-w-[640px]">
        <div className={`${grid} bg-dacs-dark px-5 py-3.5 font-semibold text-white`}>
          <span />
          <span>Name</span>
          <span>Modified</span>
          <span>Size</span>
          <span />
        </div>

        {loading && (
          <p className="py-16 text-center text-sm text-dacs-muted">
            Loading historical files…
          </p>
        )}

        {!loading && loadError && rows.length === 0 && (
          <div className="mt-4 flex flex-col items-center gap-3 rounded-dacs-card border border-dashed border-dacs-dark/30 py-16 text-center">
            <p className="text-dacs-muted">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading && !loadError && rows.length === 0 && (
          <p className="mt-4 rounded-dacs-card border border-dashed border-dacs-dark/30 py-20 text-center text-dacs-muted">
            No historical files uploaded yet.
          </p>
        )}

        {!loading &&
          folders.map((folder) => {
          const children = files.filter(
            (file) => file.category === folder.category && matches(file)
          );
          const open = openFolders[folder.category ?? ""] ?? false;
          const folderVisible =
            matches(folder) || children.length > 0 || search === "";
          if (!folderVisible) return null;

          return (
            <div key={folder.id}>
              <div className={`${grid} border-b border-dacs-light px-5 py-3.5`}>
                <input
                  type="checkbox"
                  aria-label={`Select ${folder.originalName}`}
                  checked={!!selected[folder.id]}
                  onChange={() => toggleSelected(folder.id)}
                  className="h-4 w-4 accent-dacs-red"
                />
                <button
                  type="button"
                  onClick={() =>
                    setOpenFolders({
                      ...openFolders,
                      [folder.category ?? ""]: !open,
                    })
                  }
                  className="flex items-center gap-3 text-left font-medium"
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <Folder size={20} className="fill-amber-300 text-amber-400" />
                  {folder.originalName}
                </button>
                <span>{formatDate(folder.createdAt)}</span>
                <span>
                  {files.filter((file) => file.category === folder.category).length}{" "}
                  items
                </span>
                <button
                  type="button"
                  aria-label={`Download ${folder.originalName}`}
                  onClick={() => void downloadRow(folder)}
                  className="text-dacs-muted hover:text-dacs-dark"
                >
                  <Download size={18} />
                </button>
              </div>

              {open &&
                children.map((file) => (
                  <FileRow key={file.id} file={file} indent />
                ))}
            </div>
          );
        })}

        {!loading &&
          looseFiles.map((file) => (
            <FileRow key={file.id} file={file} />
          ))}
        </div>
      </div>

      {/* Google Drive-style in-page preview */}
      {previewFile && (
        <Modal onClose={() => setPreviewFile(null)} width="max-w-[960px]">
          <div className="flex items-center gap-3 border-b border-dacs-light pb-4 pr-10">
            <FileIcon row={previewFile} />
            <h2 className="min-w-0 flex-1 truncate text-lg font-bold">
              {previewFile.originalName}
            </h2>
          </div>

          <div className="py-5">
            <PreviewBody
              row={previewFile}
              url={contentUrlFor(previewFile)}
              onDownload={() => void downloadRow(previewFile)}
            />
          </div>

          {contentUrlFor(previewFile) && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-dacs-light pt-4">
              <button
                type="button"
                onClick={() => openInNewTab(previewFile)}
                className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
              >
                <ExternalLink size={16} />
                Open
              </button>
            </div>
          )}
        </Modal>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message="Are you sure you want to delete?"
          detail={`${selectedIds.length} selected item(s) will be removed. This action cannot be undone.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          destructive
          onConfirm={() => {
            if (!deleting) void deleteSelected();
          }}
          onCancel={() => {
            if (!deleting) setConfirmingDelete(false);
          }}
        />
      )}
    </>
  );
}
