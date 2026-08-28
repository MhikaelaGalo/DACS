"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError, errorMessage } from "@/lib/api";
import { runAnalyticsQuery } from "@/lib/api/analytics";
import { formatCount, formatEnumLabel, formatPeso } from "@/lib/format";
import type {
  AnalyticsMeasureFormat,
  AnalyticsQueryResult,
  DashboardSummary,
  DashboardVisual,
} from "@/types/admin";
import { EChartsBarChart } from "../charts/EChartsBarChart";
import { EChartsHeatmap } from "../charts/EChartsHeatmap";
import { EChartsLineChart } from "../charts/EChartsLineChart";
import { EChartsPhMap } from "../charts/EChartsPhMap";
import { EChartsPieChart } from "../charts/EChartsPieChart";
import { KpiCard } from "../ui/KpiCard";

/*
 * One renderer for every dashboard visual, entirely on Apache ECharts,
 * with NO sample data anywhere: builtin visuals read the LIVE analytics
 * summary (GET /api/analytics/dashboard) passed down from the page, and
 * Create-Visual customs fetch their own aggregated series from
 * GET /api/analytics/query (computed by PostgreSQL from the field picks
 * stored on the visual). Three mockup charts have no data source in the
 * system yet (inventory levels, farmer engagement, hatch counts — open
 * client questions) and render an honest awaiting-data placeholder.
 * When a query returns nothing, the card says "No data available" —
 * numbers are never invented.
 */

/* "2026-01" -> "JANUARY" (Figma monthly-sales axis labels). */
function fullMonthUpper(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, 1))
    .toLocaleDateString("en-US", { month: "long" })
    .toUpperCase();
}

/* ---------- real-data plumbing for custom visuals ---------- */

function formatMeasureValue(
  value: number,
  format: AnalyticsMeasureFormat
): string {
  if (format === "currency") return formatPeso(Math.round(value * 100) / 100);
  if (format === "percent") {
    return `${(Math.round(value * 10) / 10).toLocaleString("en-PH")}%`;
  }
  /* Averages may be fractional even for count-like measures. */
  return formatCount(Math.round(value * 100) / 100);
}

type CustomDataState =
  | { status: "builtin" }
  | { status: "loading" }
  /* The visual predates the backend-driven builder (sample-data era). */
  | { status: "obsolete" }
  | { status: "error"; message: string }
  | { status: "ready"; result: AnalyticsQueryResult };

/*
 * Fetches the visual's real aggregated series. The dependencies are the
 * serialized configuration (the builder preview refetches, debounced,
 * as fields change) and the dashboard's refresh token (cards re-query
 * on the periodic refresh). Background refreshes keep the last good
 * series on screen instead of flashing the loading placeholder.
 */
function useCustomVisualData(
  visual: DashboardVisual,
  refreshToken = 0
): CustomDataState {
  const configKey = visual.builtin
    ? ""
    : JSON.stringify([
        visual.dataset,
        visual.xField,
        visual.xBucket,
        visual.yField,
        visual.aggregation,
        visual.legendField,
      ]);

  const [state, setState] = useState<CustomDataState>(
    visual.builtin ? { status: "builtin" } : { status: "loading" }
  );

  useEffect(() => {
    if (!configKey) return;
    const [dataset, xField, xBucket, yField, aggregation, legendField] =
      JSON.parse(configKey) as Array<string | null>;

    if (!dataset || !yField) {
      setState({ status: "obsolete" });
      return;
    }

    let cancelled = false;
    setState((current) =>
      current.status === "ready" ? current : { status: "loading" }
    );
    const timer = setTimeout(() => {
      runAnalyticsQuery({ dataset, xField, xBucket, yField, aggregation, legendField })
        .then((result) => {
          if (!cancelled) setState({ status: "ready", result });
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 400) {
            /* Fields the catalog no longer recognizes -> sample-data era. */
            setState({ status: "obsolete" });
          } else {
            /* A failed background refresh keeps the last good series. */
            setState((current) =>
              current.status === "ready"
                ? current
                : {
                    status: "error",
                    message: errorMessage(error, "Unable to load analytics data."),
                  }
            );
          }
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [configKey, refreshToken]);

  return state;
}

/*
 * Pivot the query rows into the ECharts category/series shape.
 *
 * Values flagged `enumLike` by the backend catalog (raw database enum
 * tokens such as PAYMENT_VERIFIED) are converted to display labels
 * ("Payment Verified") HERE, so axes, legends, tooltips, pie slices,
 * heatmap categories and tables all read the same clean text. Free
 * text, geography and dates pass through verbatim — product names,
 * codes and "2026-06" buckets are never title-cased. Display only:
 * the saved visual and the API keep the raw values.
 */
function pivotResult(result: AnalyticsQueryResult): {
  categories: string[];
  seriesNames: string[];
  series: Array<{ name: string; data: number[] }>;
} {
  const displayX = (value: string | null) => {
    const raw = value ?? "Unspecified";
    return result.x?.enumLike ? formatEnumLabel(raw) : raw;
  };
  const displayLegend = (value: string | null) => {
    const raw = value ?? "Unspecified";
    return result.legend?.enumLike ? formatEnumLabel(raw) : raw;
  };

  const categories: string[] = [];
  const seen = new Set<string>();
  for (const row of result.rows) {
    const x = displayX(row.x);
    if (!seen.has(x)) {
      seen.add(x);
      categories.push(x);
    }
  }

  const seriesNames = result.legend
    ? [...new Set(result.rows.map((row) => displayLegend(row.legend)))]
    : [result.measure.label];

  const index = new Map(categories.map((category, i) => [category, i]));
  const series = seriesNames.map((name) => ({
    name,
    data: new Array<number>(categories.length).fill(0),
  }));
  const seriesIndex = new Map(seriesNames.map((name, i) => [name, i]));

  for (const row of result.rows) {
    const rowIndex = index.get(displayX(row.x));
    const columnIndex = result.legend
      ? seriesIndex.get(displayLegend(row.legend))
      : 0;
    if (rowIndex === undefined || columnIndex === undefined) continue;
    series[columnIndex].data[rowIndex] = row.value ?? 0;
  }

  return { categories, seriesNames, series };
}

/* ---------- honest non-chart states ---------- */

/* No data source exists in the system yet (open client questions). */
function AwaitingData({ note }: { note: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-dacs-dark/30 px-6 text-center">
      <p className="font-semibold text-dacs-muted">Awaiting data source</p>
      <p className="max-w-[360px] text-sm text-dacs-muted">{note}</p>
    </div>
  );
}

function ChartLoading() {
  return (
    <p className="flex h-[260px] items-center justify-center text-sm text-dacs-muted">
      Loading analytics…
    </p>
  );
}

function ChartNotice({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-dacs-dark/30 px-6 text-center">
      <p className="font-semibold text-dacs-muted">{title}</p>
      <p className="max-w-[360px] text-sm text-dacs-muted">{note}</p>
    </div>
  );
}

const OBSOLETE_NOTE =
  "This visual was built on sample data that has been removed from DACS. Delete it and use “+ Create Visual” to rebuild it from real backend fields.";

const EMPTY_NOTE = "DACS has no records for this visualization yet.";

/* ---------- Figma builtin visuals ---------- */

function BuiltinChart({
  builtin,
  summary,
}: {
  builtin: string;
  summary: DashboardSummary | null;
}) {
  switch (builtin) {
    case "monthly-sales": {
      if (!summary) return <ChartLoading />;
      const perMonth = summary.charts.salesPerMonth;
      if (perMonth.length === 0) {
        return <ChartNotice title="No data available" note={EMPTY_NOTE} />;
      }
      /* Sales = orders whose payment is verified (or later); pending /
         approved orders are demand and are not plotted as sales. */
      return (
        <EChartsBarChart
          categories={perMonth.map((entry) => fullMonthUpper(entry.month))}
          series={[
            {
              name: "Sales",
              data: perMonth.map((entry) => entry.paidOrders),
            },
          ]}
          xAxisName="MONTH"
          yAxisName="# OF SALES"
          valueFormatter={formatCount}
          ariaLabel="Total number of sales per month bar chart"
        />
      );
    }
    case "hatch-vs-orders":
      return (
        <AwaitingData note="Hatch/production records are not tracked by the system yet — this chart activates once hatch data has a home." />
      );
    case "farmer-engagement":
      return (
        <AwaitingData note="Farmer session analytics are not collected yet — this chart activates once engagement tracking exists." />
      );
    case "vet-inventory":
      return (
        <AwaitingData note="Product stock levels are not tracked yet — this chart activates once inventory tracking exists." />
      );
    case "cert-map": {
      if (!summary) return <ChartLoading />;
      /* Provinces with at least one ACTIVE breeder certification are
         "Complete"; the map shades the rest as on-going. */
      const completeProvinces = summary.charts.breedersByRegion
        .filter((entry) => entry.active > 0)
        .map((entry) => entry.province);
      return (
        <EChartsPhMap
          completeProvinces={completeProvinces}
          ariaLabel="Certification status by region map of the Philippines"
        />
      );
    }
    default:
      return null;
  }
}

/* ---------- custom (Create Visual) rendering ---------- */

function CustomVisualBody({
  visual,
  state,
}: {
  visual: DashboardVisual;
  state: CustomDataState;
}) {
  if (state.status === "loading") return <ChartLoading />;
  if (state.status === "obsolete") {
    return <ChartNotice title="Obsolete sample-data visual" note={OBSOLETE_NOTE} />;
  }
  if (state.status === "error") {
    return <ChartNotice title="Analytics unavailable" note={state.message} />;
  }
  if (state.status !== "ready") return null;

  const { result } = state;
  if (result.rows.length === 0) {
    return <ChartNotice title="No data available" note={EMPTY_NOTE} />;
  }

  const { categories, seriesNames, series } = pivotResult(result);
  const format = result.measure.format;
  const valueFormatter = (value: number) => formatMeasureValue(value, format);

  switch (visual.type) {
    case "clustered-bar":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          horizontal
          valueFormatter={valueFormatter}
        />
      );
    case "clustered-column":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          valueFormatter={valueFormatter}
        />
      );
    case "stacked-bar":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          stacked
          horizontal
          valueFormatter={valueFormatter}
        />
      );
    case "stacked-column":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          stacked
          valueFormatter={valueFormatter}
        />
      );
    case "line":
      return (
        <EChartsLineChart
          categories={categories}
          series={series}
          showLegend={series.length > 1}
          valueFormatter={valueFormatter}
        />
      );
    case "line-clustered-column":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          withLine
          valueFormatter={valueFormatter}
        />
      );
    case "line-stacked-column":
      return (
        <EChartsBarChart
          categories={categories}
          series={series}
          stacked
          withLine
          valueFormatter={valueFormatter}
        />
      );
    case "pie":
      return (
        <EChartsPieChart
          data={categories.map((name, i) => ({
            name,
            value: series[0]?.data[i] ?? 0,
          }))}
          valueFormatter={valueFormatter}
        />
      );
    case "donut":
      return (
        <EChartsPieChart
          donut
          data={categories.map((name, i) => ({
            name,
            value: series[0]?.data[i] ?? 0,
          }))}
          valueFormatter={valueFormatter}
        />
      );
    case "heatmap":
      return (
        <EChartsHeatmap
          rows={categories}
          columns={seriesNames}
          values={categories.map((_, rowIndex) =>
            series.map((entry) => entry.data[rowIndex] ?? 0)
          )}
        />
      );
    case "table":
      return (
        <DataTable
          categories={categories}
          seriesNames={seriesNames}
          series={series}
          valueFormatter={valueFormatter}
        />
      );
    case "filled-map":
      return (
        <EChartsPhMap
          provinceValues={categories.map((name, i) => ({
            name,
            value: series[0]?.data[i] ?? 0,
          }))}
          valueFormatter={valueFormatter}
          ariaLabel={`${visual.title} map of the Philippines`}
        />
      );
    case "kpi": {
      const value = result.rows[0]?.value;
      return (
        <div className="flex h-full items-center justify-center py-6">
          <p className="text-5xl font-bold">
            {value === null || value === undefined
              ? "—"
              : formatMeasureValue(value, format)}
          </p>
        </div>
      );
    }
  }
}

function DataTable({
  categories,
  seriesNames,
  series,
  valueFormatter,
}: {
  categories: string[];
  seriesNames: string[];
  series: Array<{ name: string; data: number[] }>;
  valueFormatter: (value: number) => string;
}) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-dacs-light text-dacs-muted">
            <th className="rounded-l-md px-3 py-2 text-left font-semibold" />
            {seriesNames.map((name) => (
              <th key={name} className="px-3 py-2 text-right font-semibold last:rounded-r-md">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, rowIndex) => (
            <tr key={category} className="border-b border-dacs-light">
              <td className="px-3 py-2 text-left">{category}</td>
              {series.map((entry) => (
                <td key={entry.name} className="px-3 py-2 text-right">
                  {valueFormatter(entry.data[rowIndex] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- public renderer ---------- */

export function VisualBody({
  visual,
  summary = null,
  refreshToken = 0,
}: {
  visual: DashboardVisual;
  summary?: DashboardSummary | null;
  /* Bump to re-run the custom visual's analytics query. */
  refreshToken?: number;
}) {
  const state = useCustomVisualData(visual, refreshToken);

  if (visual.builtin) {
    if (visual.builtin.startsWith("kpi-")) return null;
    return <BuiltinChart builtin={visual.builtin} summary={summary} />;
  }

  return <CustomVisualBody visual={visual} state={state} />;
}

/* KPI card variant used for both builtin and configured KPI visuals. */
export function KpiValue({
  visual,
  summary = null,
  refreshToken = 0,
}: {
  visual: DashboardVisual;
  summary?: DashboardSummary | null;
  /* Bump to re-run the custom visual's analytics query. */
  refreshToken?: number;
}) {
  const state = useCustomVisualData(visual, refreshToken);

  const customValue = useMemo(() => {
    if (state.status !== "ready") return null;
    const value = state.result.rows[0]?.value;
    return value === null || value === undefined
      ? null
      : formatMeasureValue(value, state.result.measure.format);
  }, [state]);

  if (visual.builtin) {
    if (!summary) {
      return <KpiCard value="…" label={visual.title} />;
    }
    const kpis = summary.kpis;
    const byType = (orderType: string) =>
      kpis.salesByType.find((entry) => entry.orderType === orderType)?.sales ?? 0;
    const value =
      visual.builtin === "kpi-ps"
        ? byType("PARENT_STOCK")
        : visual.builtin === "kpi-f1"
          ? byType("F1")
          : visual.builtin === "kpi-vet"
            ? byType("VETERINARY_PRODUCT")
            : kpis.seminarCertificatesIssued;
    return <KpiCard value={formatCount(value)} label={visual.title} />;
  }

  if (state.status === "loading") {
    return <KpiCard value="…" label={visual.title} />;
  }
  if (state.status === "obsolete") {
    return <KpiCard value="—" label={`${visual.title} (obsolete sample-data visual)`} />;
  }
  if (state.status === "error" || customValue === null) {
    return <KpiCard value="—" label={visual.title} />;
  }
  return <KpiCard value={customValue} label={visual.title} />;
}
