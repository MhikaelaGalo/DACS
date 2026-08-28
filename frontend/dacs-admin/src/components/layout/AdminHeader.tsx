"use client";

import { Search } from "lucide-react";

/*
 * Standard page header: the page title, then (optionally) the rounded
 * Search box, the filter funnel and the page's primary action on the
 * right. (The notification bell moved into the left sidebar.)
 */
export function AdminHeader({
  title,
  search,
  right,
}: {
  title: string;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 lg:mb-8">
      <h1 className="min-w-0 truncate text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">
        {title}
      </h1>

      <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
        {search && (
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <input
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder ?? "Search..."}
              className="w-full rounded-full border border-dacs-dark/40 py-2.5 pl-5 pr-11 text-sm italic outline-none focus:border-dacs-dark sm:w-[240px] lg:w-[320px]"
            />
            <Search
              size={18}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-dacs-dark"
            />
          </div>
        )}
        {right}
      </div>
    </div>
  );
}
