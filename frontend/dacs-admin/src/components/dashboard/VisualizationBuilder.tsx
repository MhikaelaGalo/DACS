"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";

import { errorMessage } from "@/lib/api";
import { getAnalyticsFields } from "@/lib/api/analytics";
import type {
  AnalyticsAggregation,
  AnalyticsDataset,
  AnalyticsFieldCatalog,
  AnalyticsMeasure,
  DashboardVisual,
  VisualType,
} from "@/types/admin";
import { KpiValue, VisualBody } from "./ChartRenderer";

const CHART_TYPES: { value: VisualType; label: string }[] = [
  { value: "clustered-column", label: "Column chart" },
  { value: "clustered-bar", label: "Horizontal bar chart" },
  { value: "stacked-column", label: "Stacked column chart" },
  { value: "stacked-bar", label: "Stacked horizontal bar chart" },
  { value: "line", label: "Line chart" },
  { value: "line-clustered-column", label: "Columns with a line" },
  { value: "line-stacked-column", label: "Stacked columns with a line" },
  { value: "pie", label: "Pie chart" },
  { value: "donut", label: "Donut chart" },
  { value: "kpi", label: "Single number (KPI)" },
  { value: "table", label: "Table" },
  { value: "filled-map", label: "Map by province" },
  { value: "heatmap", label: "Heatmap" },
];

const CALCULATION = {
  sum: "Total",
  avg: "Average",
  min: "Lowest",
  max: "Highest",
};

function metricOptions(dataset: AnalyticsDataset) {
  function label(measure: AnalyticsMeasure, calculation: AnalyticsAggregation) {
    if (dataset.id === "order-items") {
      if (measure.id === "count") return "Number of order lines";
      if (measure.id === "quantity" && calculation !== "count") {
        return calculation === "sum"
          ? "Total units ordered"
          : `${CALCULATION[calculation]} units per order line`;
      }
      if (measure.id === "lineTotal" && calculation !== "count") {
        return calculation === "sum"
          ? "Total value of order items (PHP)"
          : `${CALCULATION[calculation]} order line value (PHP)`;
      }
    }
    if (calculation === "count") return measure.label;
    return `${CALCULATION[calculation]} ${measure.label}`;
  }

  return dataset.measures.flatMap((measure) =>
    measure.aggregations.map((calculation) => ({
      value: `${measure.id}/${calculation}`,
      label: label(measure, calculation),
      yField: measure.id,
      aggregation: calculation,
    }))
  );
}

const FIELD_STYLE =
  "w-full min-w-0 rounded-lg border border-dacs-dark/30 bg-white px-3 py-2.5 text-sm text-dacs-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dacs-dark disabled:opacity-50";

function FieldPicker({
  label, value, options, placeholder, hint, disabled, optional, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  optional?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block font-semibold">{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={FIELD_STYLE}
      >
        {placeholder && <option value="" disabled={!optional}>{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-sm text-dacs-muted">{hint}</p>}
    </div>
  );
}

export function VisualizationBuilder({
  onCreate,
  onCancel,
}: {
  onCreate: (visual: DashboardVisual) => void;
  onCancel: () => void;
}) {
  const draftId = useId();
  const [catalog, setCatalog] = useState<AnalyticsFieldCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [type, setType] = useState<VisualType>("clustered-column");
  const [datasetId, setDatasetId] = useState("");
  const [metricId, setMetricId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [dateBucket, setDateBucket] = useState("month");
  const [splitId, setSplitId] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAnalyticsFields()
      .then((fields) => {
        if (!cancelled) setCatalog(fields);
      })
      .catch((error) => {
        if (!cancelled) setCatalogError(errorMessage(error, "Unable to load the data sources."));
      });
    return () => { cancelled = true; };
  }, []);

  const dataset = catalog?.datasets.find((entry) => entry.id === datasetId);
  const isMap = type === "filled-map";
  const isHeatmap = type === "heatmap";
  const isPie = type === "pie" || type === "donut";
  const needsGroup = type !== "kpi";
  const allowsSplit = needsGroup && !isMap && !isPie;
  const isCombo = type === "line-clustered-column" || type === "line-stacked-column";
  const sources = (catalog?.datasets ?? []).filter((source) =>
    !isMap || source.dimensions.some((dimension) => dimension.kind === "geo")
  );
  const supportsMap = !dataset || dataset.dimensions.some((dimension) => dimension.kind === "geo");
  const chartTypes = CHART_TYPES.filter((chart) => chart.value !== "filled-map" || supportsMap);
  const metrics = dataset ? metricOptions(dataset) : [];
  const metric = metrics.length === 1 ? metrics[0] : metrics.find((entry) => entry.value === metricId);
  const dimensions = dataset?.dimensions ?? [];
  const splitDimensions = dimensions.filter((entry) => entry.kind !== "date");
  const groups = needsGroup ? dimensions.filter((entry) => {
    if (isMap) return entry.kind === "geo";
    if (isHeatmap) return splitDimensions.some((column) => column.id !== entry.id);
    return true;
  }) : [];
  const group = groups.length === 1 ? groups[0] : groups.find((entry) => entry.id === groupId);
  const splits = allowsSplit ? splitDimensions.filter((entry) => entry.id !== group?.id) : [];
  const split = splits.find((entry) => entry.id === splitId);
  const bucket = group?.kind === "date" ? dateBucket : null;

  function pickDataset(id: string) {
    setDatasetId(id);
    setMetricId("");
    setGroupId("");
    setSplitId("");
    setDateBucket("month");
  }

  function pickGroup(id: string) {
    setGroupId(id);
    setDateBucket("month");
    if (splitId === id) setSplitId("");
  }

  function pickType(next: VisualType) {
    setType(next);
    if (next === "kpi" || (next === "filled-map" && group?.kind !== "geo")) {
      pickGroup("");
    }
    if (next === "kpi" || next === "filled-map" || next === "pie" || next === "donut") {
      setSplitId("");
    }
  }

  const groupLabel = isHeatmap ? "Rows" : isMap ? "Province field" : isPie ? "Group slices by" : "Group by";
  const suggestedTitle = [
    metric?.label,
    group && `by ${group.label}${bucket ? ` (${bucket})` : ""}`,
    split && `and ${split.label}`,
  ].filter(Boolean).join(" ");
  const preview: DashboardVisual | null =
    dataset && metric && (!needsGroup || group) && (!isHeatmap || split)
      ? {
          id: "preview",
          type,
          title: title.trim() || suggestedTitle,
          dataset: dataset.id,
          yField: metric.yField,
          aggregation: metric.aggregation,
          xField: group?.id ?? null,
          xBucket: bucket,
          legendField: split?.id ?? null,
        }
      : null;

  function create() {
    if (!preview) return;
    onCreate({ ...preview, id: draftId });
  }

  let previewHint = "Choose a data source to start your chart.";
  if (catalogError) previewHint = "Preview is unavailable until the data sources load.";
  else if (dataset && !metric) previewHint = "Choose what to measure to continue.";
  else if (dataset && !group && needsGroup) {
    previewHint = isHeatmap ? "Choose a field for the heatmap rows." : "Choose how to group the results.";
  } else if (isHeatmap && group) previewHint = "Choose a field for the heatmap columns.";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="create-visual-title" className="max-h-full w-full max-w-[1100px] overflow-y-auto rounded-dacs-card bg-white p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h2 id="create-visual-title" className="text-2xl font-bold sm:text-3xl">Create visual</h2>
          <button type="button" aria-label="Close visualization builder" onClick={onCancel} className="rounded-lg p-2 hover:bg-dacs-light">
            <X size={22} />
          </button>
        </div>

        {catalogError && <p role="alert" className="mt-4 text-sm text-dacs-red">{catalogError}</p>}

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="min-w-0 space-y-5">
            <FieldPicker
              label="Which records do you want to use?"
              value={datasetId}
              options={sources.map((entry) => ({ value: entry.id, label: entry.label }))}
              placeholder={catalogError ? "Data sources unavailable" : catalog ? "Choose a data source" : "Loading data sources…"}
              disabled={!catalog}
              hint={dataset?.id === "order-items"
                ? "Each product or seminar module in an order has its own line. A line for 5 units counts as 1 order line or 5 units ordered."
                : dataset?.description}
              onChange={pickDataset}
            />
            {dataset && (
              <FieldPicker
                label="What do you want to measure?"
                value={metric?.value ?? ""}
                options={metrics}
                placeholder="Choose a calculation"
                onChange={setMetricId}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldPicker
                label="Chart type"
                value={type}
                options={chartTypes}
                hint={isCombo ? "The line repeats the first set of bars." : undefined}
                onChange={(value) => pickType(value as VisualType)}
              />
              {dataset && needsGroup && (
                <FieldPicker
                  label={groupLabel}
                  value={group?.id ?? ""}
                  options={groups.map((entry) => ({ value: entry.id, label: entry.label }))}
                  placeholder="Choose a field"
                  onChange={pickGroup}
                />
              )}
              {bucket && (
                <FieldPicker
                  label="Group dates by"
                  value={bucket}
                  options={(catalog?.dateBuckets ?? []).map((entry) => ({ value: entry.id, label: entry.label }))}
                  onChange={setDateBucket}
                />
              )}
              {group && splits.length > 0 && (
                <FieldPicker
                  label={isHeatmap ? "Columns" : "Split each group by (optional)"}
                  value={split?.id ?? ""}
                  options={splits.map((entry) => ({ value: entry.id, label: entry.label }))}
                  placeholder={isHeatmap ? "Choose a second field" : "No split"}
                  optional={!isHeatmap}
                  onChange={setSplitId}
                />
              )}
            </div>
            {dataset && (
              <label className="block">
                <span className="mb-1.5 block font-semibold">Chart title (optional)</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={150}
                  placeholder={metric ? suggestedTitle : "Use the suggested title"}
                  className={FIELD_STYLE}
                />
              </label>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="mb-2 font-semibold">Preview</h3>
            <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dacs-dark/20 p-4 lg:min-h-[320px]">
              {preview ? (
                <div className="w-full min-w-0">
                  <h4 className="mb-3 break-words text-center font-bold">{preview.title}</h4>
                  {preview.type === "kpi" ? <KpiValue visual={preview} /> : <VisualBody visual={preview} />}
                </div>
              ) : (
                <p className="px-4 text-center text-sm text-dacs-muted">{previewHint}</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={create}
            disabled={!preview}
            className="rounded-2xl bg-dacs-dark px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            Add to dashboard
          </button>
          <button type="button" onClick={onCancel} className="rounded-2xl border border-dacs-dark/40 px-6 py-3 font-semibold hover:bg-dacs-light/50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
