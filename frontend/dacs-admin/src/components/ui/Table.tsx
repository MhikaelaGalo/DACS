"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/*
 * Mockup table styling: black header band with white labels, hairline
 * row dividers, horizontal scroll INSIDE the table container so wide
 * monitoring tables never stretch the page.
 */
export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full min-w-max border-collapse text-[15px]">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  /* Columns default to the mockup's centered style; text columns such as
     names read better left aligned. */
  align?: "left" | "center";
}) {
  return (
    <th
      className={`whitespace-nowrap bg-dacs-dark px-5 py-3.5 font-semibold text-white first:rounded-l-md last:rounded-r-md ${
        align === "left" ? "text-left" : "text-center"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
  align = "center",
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
  align?: "left" | "center";
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-dacs-light px-5 py-3.5 ${
        align === "left" ? "text-left" : "text-center"
      } ${className}`}
    >
      {children}
    </td>
  );
}

export const PAGE_SIZE = 10;

/*
 * Figma pagination: ◀ 1-N of N ▶ with working arrows. Hidden entirely
 * while every record fits on one page — it only appears once there are
 * enough records to actually paginate.
 */
export function Pagination({
  page,
  pageSize = PAGE_SIZE,
  total,
  onPageChange,
}: {
  page: number;
  pageSize?: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, pages - 1);
  const start = total === 0 ? 0 : clamped * pageSize + 1;
  const end = Math.min(total, (clamped + 1) * pageSize);

  return (
    <div className="mt-6 flex items-center justify-center gap-4 text-sm text-dacs-muted">
      <button
        type="button"
        aria-label="Previous page"
        disabled={clamped === 0}
        onClick={() => onPageChange(clamped - 1)}
        className="rounded-full p-1 hover:bg-dacs-light disabled:opacity-30"
      >
        <ChevronLeft size={18} />
      </button>
      <span>
        {start === 0 ? "0" : `${start}-${end}`} of {total}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={clamped >= pages - 1}
        onClick={() => onPageChange(clamped + 1)}
        className="rounded-full p-1 hover:bg-dacs-light disabled:opacity-30"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function pageSlice<T>(rows: T[], page: number, pageSize = PAGE_SIZE): T[] {
  const clamped = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  return rows.slice(clamped * pageSize, (clamped + 1) * pageSize);
}
