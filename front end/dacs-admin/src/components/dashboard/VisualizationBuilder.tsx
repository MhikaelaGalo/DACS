"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChartBar,
  ChartBarStacked,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartPie,
  ChartSpline,
  Grid3x3,
  Map,
  Table,
  TrendingUp,
  X,
} from "lucide-react";

import { errorMessage } from "@/lib/api";
import { getAnalyticsFields } from "@/lib/api/analytics";
import type {
  AnalyticsDataset,
  AnalyticsFieldCatalog,
  DashboardVisual,
  VisualType,
} from "@/types/admin";
import { KpiValue, VisualBody } from "./ChartRenderer";

/*
 * The Create Visual state (Figma "Visualization" frame): chart-type
 * grid, field pickers, Title, live Preview, then Create / Cancel.
 *
 * Every pickable field comes from the backend analytics catalog
 * (GET /api/analytics/fields) — the browser holds no dataset of its
 * own, and the preview chart is the real aggregated series from
 * GET /api/analytics/query. Pickers are filtered per chart type: a
 * filled map only offers province (geographic) fields, a KPI takes a
 * measure only, a heatmap requires a legend, dates offer day / month /
 * quarter / year grouping, and each measure lists only aggregations
 * that make sense for it.
 */

const CHART_TYPES: Array<{
  type: VisualType;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = [
  { type: "clustered-bar", label: "Clustered Bar Chart", icon: ChartBar },
  { type: "clustered-column", label: "Clustered Column Chart", icon: ChartColumn },
  { type: "stacked-bar", label: "Stacked Bar Chart", icon: ChartBarStacked },
  { type: "stacked-column", label: "Stacked Column Chart", icon: ChartColumnStacked },
  { type: "line", label: "Line Chart", icon: ChartLine },
  { type: "line-clustered-column", label: "Line & Clustered Column Chart", icon: TrendingUp },
  { type: "line-stacked-column", label: "Line & Stacked Column Chart", icon: ChartSpline },
  { type: "pie", label: "Pie Chart", icon: ChartPie },
  { type: "donut", label: "Donut Chart", icon: DonutTile },
  { type: "kpi", label: "KPI", icon: KpiTile },
  { type: "table", label: "Table", icon: Table },
  { type: "filled-map", label: "Filled Map Chart", icon: Map },
  { type: "heatmap", label: "Heatmap", icon: Grid3x3 },
];

/* Field-picker requirements per chart type. */
const TYPE_RULES: Record<
  VisualType,
  { x: "none" | "any" | "geo"; legend: "none" | "optional" | "required" }
> = {
  "clustered-bar": { x: "any", legend: "optional" },
  "clustered-column": { x: "any", legend: "optional" },
  "stacked-bar": { x: "any", legend: "optional" },
  "stacked-column": { x: "any", legend: "optional" },
  line: { x: "any", legend: "optional" },
  "line-clustered-column": { x: "any", legend: "optional" },
  "line-stacked-column": { x: "any", legend: "optional" },
  pie: { x: "any", legend: "none" },
  donut: { x: "any", legend: "none" },
  kpi: { x: "none", legend: "none" },
  table: { x: "any", legend: "optional" },
  "filled-map": { x: "geo", legend: "none" },
  heatmap: { x: "any", legend: "required" },
};

const AGGREGATION_LABELS: Record<string, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

function KpiTile({ size = 24, className = "" }: { size?: number | string; className?: string }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={`flex items-center justify-center rounded bg-dacs-red/80 text-[9px] font-bold text-white ${className}`}
    >
      123
    </span>
  );
}

/* Donut-chart glyph: thick ring with slice gaps (the Figma icon). */
function DonutTile({ size = 24, className = "" }: { size?: number | string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="5"
      className={className}
      aria-hidden="true"
    >
      {/* two arcs forming a ring with visible slice separations */}
      <path d="M 12 4.5 A 7.5 7.5 0 1 1 5.05 14.55" strokeLinecap="butt" />
      <path d="M 4.55 11.1 A 7.5 7.5 0 0 1 9.4 5.0" strokeLinecap="butt" />
    </svg>
  );
}

function FieldPicker({
  label,
  value,
  options,
  placeholder = "Add data fields here",
  disabled = false,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 font-bold">{label}</p>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className={`w-full border border-dashed border-dacs-dark/40 px-3 py-2.5 text-sm outline-none focus:border-dacs-dark disabled:opacity-50 ${
          value ? "" : "italic text-dacs-muted"
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

let visualCounter = 0;

export function VisualizationBuilder({
  onCreate,
  onCancel,
}: {
  onCreate: (visual: DashboardVisual) => void;
  onCancel: () => void;
}) {
  const [catalog, setCatalog] = useState<AnalyticsFieldCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [type, setType] = useState<VisualType | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [xField, setXField] = useState<string | null>(null);
  const [xBucket, setXBucket] = useState<string | null>(null);
  const [yField, setYField] = useState<string | null>(null);
  const [aggregation, setAggregation] = useState<string | null>(null);
  const [legendField, setLegendField] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAnalyticsFields()
      .then((fields) => {
        if (!cancelled) setCatalog(fields);
      })
      .catch((error) => {
        if (!cancelled) {
          setCatalogError(
            errorMessage(error, "Unable to load the analytics fields.")
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dataset: AnalyticsDataset | null =
    catalog?.datasets.find((entry) => entry.id === datasetId) ?? null;
  /* Until a chart type is picked, offer the least restrictive pickers
     so fields can be chosen in any order. */
  const rules = type
    ? TYPE_RULES[type]
    : ({ x: "any", legend: "optional" } as const);

  const xDimension = dataset?.dimensions.find((entry) => entry.id === xField);
  const measure = dataset?.measures.find((entry) => entry.id === yField);

  /* ---- option lists, all straight from the backend catalog ---- */

  const xOptions = useMemo(() => {
    if (!dataset || !rules || rules.x === "none") return [];
    const dimensions =
      rules.x === "geo"
        ? dataset.dimensions.filter((entry) => entry.kind === "geo")
        : dataset.dimensions;
    return dimensions
      .filter((entry) => entry.id !== legendField)
      .map((entry) => ({ value: entry.id, label: entry.label }));
  }, [dataset, rules, legendField]);

  const legendOptions = useMemo(() => {
    if (!dataset || !rules || rules.legend === "none") return [];
    return dataset.dimensions
      .filter((entry) => entry.kind !== "date" && entry.id !== xField)
      .map((entry) => ({ value: entry.id, label: entry.label }));
  }, [dataset, rules, xField]);

  const yOptions = useMemo(
    () =>
      dataset?.measures.map((entry) => ({
        value: entry.id,
        label: entry.label,
      })) ?? [],
    [dataset]
  );

  const aggregationOptions = useMemo(
    () =>
      measure?.aggregations.map((entry) => ({
        value: entry,
        label: AGGREGATION_LABELS[entry] ?? entry,
      })) ?? [],
    [measure]
  );

  /* ---- pick handlers that keep the configuration coherent ---- */

  function pickType(next: VisualType) {
    setType(next);
    const nextRules = TYPE_RULES[next];
    if (nextRules.x === "none") {
      setXField(null);
      setXBucket(null);
    }
    if (nextRules.legend === "none") setLegendField(null);
    /* A map's location must be geographic — drop an incompatible X. */
    if (nextRules.x === "geo") {
      const stillValid = dataset?.dimensions.some(
        (entry) => entry.id === xField && entry.kind === "geo"
      );
      if (!stillValid) {
        setXField(null);
        setXBucket(null);
      }
    }
  }

  function pickDataset(next: string | null) {
    setDatasetId(next);
    setXField(null);
    setXBucket(null);
    setYField(null);
    setAggregation(null);
    setLegendField(null);
  }

  function pickX(next: string | null) {
    setXField(next);
    const dimension = dataset?.dimensions.find((entry) => entry.id === next);
    setXBucket(dimension?.kind === "date" ? "month" : null);
  }

  function pickY(next: string | null) {
    setYField(next);
    const nextMeasure = dataset?.measures.find((entry) => entry.id === next);
    setAggregation(nextMeasure?.aggregations[0] ?? null);
  }

  /* ---- readiness + preview ---- */

  const ready =
    type !== null &&
    dataset !== null &&
    yField !== null &&
    (rules?.x === "none" || xField !== null) &&
    (rules?.legend !== "required" || legendField !== null);

  const preview: DashboardVisual | null =
    type && dataset && ready
      ? {
          id: "preview",
          type,
          title: title || "Untitled Visual",
          dataset: dataset.id,
          xField,
          xBucket,
          yField,
          aggregation,
          legendField,
        }
      : null;

  function create() {
    if (!preview || !ready) return;
    visualCounter += 1;
    onCreate({ ...preview, id: `visual-${Date.now()}-${visualCounter}` });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 sm:p-6">
      <div className="max-h-full w-full max-w-[1180px] overflow-y-auto rounded-dacs-card bg-white p-5 sm:p-10">
        <div className="flex items-center gap-6">
          <button
            type="button"
            aria-label="Close visualization builder"
            onClick={onCancel}
            className="text-dacs-dark hover:text-dacs-red"
          >
            <X size={28} />
          </button>
          <h2 className="text-2xl font-bold sm:text-3xl">Visualization</h2>
        </div>

        {catalogError && (
          <p className="mt-6 rounded-xl border border-dashed border-dacs-dark/30 px-6 py-4 text-center text-sm text-dacs-muted">
            {catalogError}
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-8 sm:mt-8 xl:grid-cols-[1fr_460px] xl:gap-10">
          <div>
            <p className="mb-3 font-bold">Charts</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {CHART_TYPES.map(({ type: chartType, label, icon: Icon }) => (
                <button
                  key={chartType}
                  type="button"
                  onClick={() => pickType(chartType)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center text-xs font-medium transition-colors ${
                    type === chartType
                      ? "border-dacs-red bg-red-50 text-dacs-red"
                      : "border-transparent hover:bg-dacs-light/60"
                  }`}
                >
                  <Icon size={30} className={type === chartType ? "text-dacs-red" : "text-dacs-dark"} />
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
              <FieldPicker
                label="Data source"
                value={datasetId}
                options={
                  catalog?.datasets.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  })) ?? []
                }
                placeholder={catalog ? "Choose backend data" : "Loading fields…"}
                disabled={!catalog}
                onChange={pickDataset}
              />
              <FieldPicker
                label={
                  type === "filled-map"
                    ? "Location (province field)"
                    : type === "pie" || type === "donut"
                      ? "Category (slices)"
                      : "X-axis"
                }
                value={xField}
                options={xOptions}
                disabled={!dataset || rules?.x === "none"}
                placeholder={
                  rules?.x === "none"
                    ? "Not used for a KPI"
                    : "Add data fields here"
                }
                onChange={pickX}
              />
              <FieldPicker
                label={type === "kpi" ? "Measure" : "Y-axis (values)"}
                value={yField}
                options={yOptions}
                disabled={!dataset}
                onChange={pickY}
              />
              <FieldPicker
                label="Aggregation"
                value={aggregation}
                options={aggregationOptions}
                disabled={!measure || aggregationOptions.length <= 1}
                placeholder={measure ? "Choose aggregation" : "Pick a value field first"}
                onChange={(value) => setAggregation(value)}
              />
              <FieldPicker
                label="Legend"
                value={legendField}
                options={legendOptions}
                disabled={!dataset || rules?.legend === "none"}
                placeholder={
                  rules?.legend === "none"
                    ? "Not used for this chart type"
                    : rules?.legend === "required"
                      ? "Required for a heatmap"
                      : "Add data fields here"
                }
                onChange={setLegendField}
              />
              {xDimension?.kind === "date" && (
                <FieldPicker
                  label="Date grouping"
                  value={xBucket}
                  options={
                    catalog?.dateBuckets.map((bucket) => ({
                      value: bucket.id,
                      label: bucket.label,
                    })) ?? []
                  }
                  placeholder="Group dates by…"
                  onChange={(value) => setXBucket(value ?? "month")}
                />
              )}
              <div>
                <p className="mb-1.5 font-bold">Title</p>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Type here..."
                  className="w-full border-b border-dashed border-dacs-dark/40 px-1 py-2 text-sm italic outline-none focus:border-dacs-dark"
                />
              </div>
            </div>

            {dataset && (
              <p className="mt-4 text-sm italic text-dacs-muted">
                {dataset.description}
              </p>
            )}

            <div className="mt-10 flex items-center gap-3">
              <button
                type="button"
                onClick={create}
                disabled={!ready}
                className="rounded-2xl bg-dacs-dark px-9 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-2xl border border-dacs-dark/40 px-8 py-3.5 font-semibold hover:bg-dacs-light/50"
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Preview — the real aggregated series, never sample data. */}
          <div>
            <p className="mb-3 font-bold">Preview</p>
            <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-dacs-dark/30 p-4">
              {preview ? (
                <div className="w-full">
                  <h3 className="mb-3 text-center font-bold">{preview.title}</h3>
                  {preview.type === "kpi" ? (
                    <KpiValue visual={preview} />
                  ) : (
                    <VisualBody visual={preview} />
                  )}
                </div>
              ) : (
                <p className="px-6 text-center text-sm italic text-dacs-muted">
                  {type
                    ? "Choose a data source and fields to preview real DACS data here."
                    : "Pick a chart type to get started."}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
