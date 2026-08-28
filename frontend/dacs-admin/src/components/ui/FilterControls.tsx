"use client";

import { useMemo, useState } from "react";
import { Filter } from "lucide-react";

/*
 * The Figma table-filter popover (the two small panels next to the
 * login frames): Sort A to Z / Z to A, Filter by Condition with the
 * full operator list, and Filter by Values with Select All – Clear and
 * a search box. One funnel per table; a Column select scopes it.
 */

export const FILTER_CONDITIONS = [
  "None",
  "Is Empty",
  "Is Not Empty",
  "Text contains",
  "Text does not contain",
  "Text starts with",
  "Text ends with",
  "Text is exactly",
  "Date is",
  "Date is before",
  "Date is after",
  "Greater than",
  "Greater than or equal to",
  "Less than",
  "Less than or equal to",
  "Is equal to",
  "Is not equal to",
  "Is between",
  "Is not between",
] as const;

export type FilterCondition = (typeof FILTER_CONDITIONS)[number];

export interface TableColumn<Row> {
  key: string;
  label: string;
  get: (row: Row) => string | number | null | undefined;
}

export interface TableQuery {
  column: string;
  sort: "none" | "asc" | "desc";
  condition: FilterCondition;
  conditionValue: string;
  conditionValue2: string;
  /* null = all values allowed; otherwise the allowed value set */
  values: string[] | null;
}

export function emptyQuery(defaultColumn: string): TableQuery {
  return {
    column: defaultColumn,
    sort: "none",
    condition: "None",
    conditionValue: "",
    conditionValue2: "",
    values: null,
  };
}

function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function matchesCondition(raw: string, query: TableQuery): boolean {
  const value = raw.toLowerCase();
  const needle = query.conditionValue.toLowerCase();
  const numeric = Number(raw);
  const bound1 = Number(query.conditionValue);
  const bound2 = Number(query.conditionValue2);
  const date = Date.parse(raw);
  const dateBound = Date.parse(query.conditionValue);

  switch (query.condition) {
    case "None":
      return true;
    case "Is Empty":
      return raw.trim() === "" || raw.trim() === "N/A";
    case "Is Not Empty":
      return raw.trim() !== "" && raw.trim() !== "N/A";
    case "Text contains":
      return value.includes(needle);
    case "Text does not contain":
      return !value.includes(needle);
    case "Text starts with":
      return value.startsWith(needle);
    case "Text ends with":
      return value.endsWith(needle);
    case "Text is exactly":
      return value === needle;
    case "Date is":
      return !Number.isNaN(date) && !Number.isNaN(dateBound) && date === dateBound;
    case "Date is before":
      return !Number.isNaN(date) && !Number.isNaN(dateBound) && date < dateBound;
    case "Date is after":
      return !Number.isNaN(date) && !Number.isNaN(dateBound) && date > dateBound;
    case "Greater than":
      return numeric > bound1;
    case "Greater than or equal to":
      return numeric >= bound1;
    case "Less than":
      return numeric < bound1;
    case "Less than or equal to":
      return numeric <= bound1;
    case "Is equal to":
      return raw === query.conditionValue || numeric === bound1;
    case "Is not equal to":
      return raw !== query.conditionValue && numeric !== bound1;
    case "Is between":
      return numeric >= Math.min(bound1, bound2) && numeric <= Math.max(bound1, bound2);
    case "Is not between":
      return numeric < Math.min(bound1, bound2) || numeric > Math.max(bound1, bound2);
  }
}

export function applyQuery<Row>(
  rows: Row[],
  columns: Array<TableColumn<Row>>,
  query: TableQuery
): Row[] {
  const column = columns.find((entry) => entry.key === query.column);
  if (!column) return rows;

  let result = rows.filter((row) => {
    const raw = cellText(column.get(row));
    if (query.values !== null && !query.values.includes(raw)) return false;
    return matchesCondition(raw, query);
  });

  if (query.sort !== "none") {
    result = [...result].sort((a, b) => {
      const left = cellText(column.get(a));
      const right = cellText(column.get(b));
      const numLeft = Number(left);
      const numRight = Number(right);
      const compared =
        !Number.isNaN(numLeft) && !Number.isNaN(numRight) && left !== "" && right !== ""
          ? numLeft - numRight
          : left.localeCompare(right);
      return query.sort === "asc" ? compared : -compared;
    });
  }

  return result;
}

const NEEDS_ONE_VALUE: FilterCondition[] = [
  "Text contains",
  "Text does not contain",
  "Text starts with",
  "Text ends with",
  "Text is exactly",
  "Date is",
  "Date is before",
  "Date is after",
  "Greater than",
  "Greater than or equal to",
  "Less than",
  "Less than or equal to",
  "Is equal to",
  "Is not equal to",
];
const NEEDS_TWO_VALUES: FilterCondition[] = ["Is between", "Is not between"];

export function FilterButton<Row>({
  rows,
  columns,
  query,
  onChange,
}: {
  rows: Row[];
  columns: Array<TableColumn<Row>>;
  query: TableQuery;
  onChange: (query: TableQuery) => void;
}) {
  const [open, setOpen] = useState(false);
  const [valueSearch, setValueSearch] = useState("");

  const column = columns.find((entry) => entry.key === query.column) ?? columns[0];

  const distinctValues = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) set.add(cellText(column.get(row)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows, column]);

  const visibleValues = distinctValues.filter((value) =>
    value.toLowerCase().includes(valueSearch.toLowerCase())
  );

  const active =
    query.sort !== "none" || query.condition !== "None" || query.values !== null;

  function toggleValue(value: string) {
    const current = query.values ?? distinctValues;
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
    onChange({ ...query, values: next });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Filter table"
        onClick={() => setOpen(!open)}
        className={`rounded-full p-2 hover:bg-dacs-light ${
          active ? "text-dacs-red" : "text-dacs-dark"
        }`}
      >
        <Filter size={22} fill={active ? "currentColor" : "none"} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(300px,calc(100vw-2.5rem))] rounded-2xl border border-dacs-light bg-white p-5 text-[15px] shadow-dacs-card">
          <label className="mb-3 block">
            <span className="text-xs font-semibold uppercase text-dacs-muted">
              Column
            </span>
            <select
              value={column.key}
              onChange={(event) =>
                onChange({
                  ...emptyQuery(event.target.value),
                  sort: query.sort,
                })
              }
              className="mt-1 w-full rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
            >
              {columns.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() =>
              onChange({ ...query, sort: query.sort === "asc" ? "none" : "asc" })
            }
            className={`block w-full py-1.5 text-left hover:text-dacs-red ${
              query.sort === "asc" ? "font-bold text-dacs-red" : ""
            }`}
          >
            Sort A to Z
          </button>
          <button
            type="button"
            onClick={() =>
              onChange({ ...query, sort: query.sort === "desc" ? "none" : "desc" })
            }
            className={`block w-full py-1.5 text-left hover:text-dacs-red ${
              query.sort === "desc" ? "font-bold text-dacs-red" : ""
            }`}
          >
            Sort Z to A
          </button>

          <p className="mt-3 border-t border-dacs-light pt-3 font-bold">
            Filter by Condition
          </p>
          <select
            value={query.condition}
            onChange={(event) =>
              onChange({
                ...query,
                condition: event.target.value as FilterCondition,
              })
            }
            className="mt-2 w-full rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
          >
            {FILTER_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
          {NEEDS_ONE_VALUE.includes(query.condition) && (
            <input
              value={query.conditionValue}
              onChange={(event) =>
                onChange({ ...query, conditionValue: event.target.value })
              }
              placeholder="Value..."
              className="mt-2 w-full rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
            />
          )}
          {NEEDS_TWO_VALUES.includes(query.condition) && (
            <div className="mt-2 flex gap-2">
              <input
                value={query.conditionValue}
                onChange={(event) =>
                  onChange({ ...query, conditionValue: event.target.value })
                }
                placeholder="From..."
                className="w-1/2 rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
              />
              <input
                value={query.conditionValue2}
                onChange={(event) =>
                  onChange({ ...query, conditionValue2: event.target.value })
                }
                placeholder="To..."
                className="w-1/2 rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
              />
            </div>
          )}

          <p className="mt-3 border-t border-dacs-light pt-3 font-bold">
            Filter by Values
          </p>
          <p className="mt-1 text-sm">
            <button
              type="button"
              onClick={() => onChange({ ...query, values: null })}
              className="text-dacs-red underline"
            >
              Select All
            </button>
            <span className="mx-1 text-dacs-muted">–</span>
            <button
              type="button"
              onClick={() => onChange({ ...query, values: [] })}
              className="text-dacs-red underline"
            >
              Clear
            </button>
          </p>
          <input
            value={valueSearch}
            onChange={(event) => setValueSearch(event.target.value)}
            placeholder="Search values..."
            className="mt-2 w-full rounded-lg border border-dacs-dark/30 px-2 py-1.5 text-sm"
          />
          <div className="mt-2 max-h-[160px] overflow-y-auto">
            {visibleValues.map((value) => {
              const checked = query.values === null || query.values.includes(value);
              return (
                <label
                  key={value || "(empty)"}
                  className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleValue(value)}
                    className="accent-dacs-red"
                  />
                  <span className="truncate">{value || "(empty)"}</span>
                </label>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-4 w-full rounded-xl bg-dacs-dark py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
