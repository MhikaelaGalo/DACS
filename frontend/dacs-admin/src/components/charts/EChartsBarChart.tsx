"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  barCategoryAxis,
  columnCategoryAxis,
  DEFAULT_CHART_WIDTH,
  useContainerWidth,
} from "./categoryAxis";
import {
  CHART_COLORS,
  ECHARTS_AXIS_LABEL,
  ECHARTS_LEGEND,
  ECHARTS_TOOLTIP,
  GRID,
  INK,
} from "./ChartTheme";
import { EChart } from "./EChart";

/*
 * Reusable DACS bar/column chart on Apache ECharts, styled after the
 * Figma dashboard bar charts: solid brand-red bars with rounded tops,
 * bold plain-number value labels above the bars, axis titles ("MONTH"
 * below, "SALES (PHP)" rotated), hairline gridlines.
 *
 * One component covers the whole bar family:
 *   - single series      -> Figma monthly-sales look
 *   - several series     -> clustered columns (legend at the bottom)
 *   - stacked            -> stacked columns
 *   - horizontal         -> bar (category axis vertical)
 *   - withLine           -> combination chart (line over the columns)
 *   - thresholdLine      -> red reference line (vet inventory levels)
 */

export interface EChartsBarSeries {
  name: string;
  data: number[];
  color?: string;
}

export function EChartsBarChart({
  categories,
  series,
  stacked = false,
  horizontal = false,
  withLine = false,
  thresholdLine,
  xAxisName,
  yAxisName,
  height = 260,
  showValueLabels = true,
  valueFormatter,
  ariaLabel,
}: {
  categories: string[];
  series: EChartsBarSeries[];
  stacked?: boolean;
  horizontal?: boolean;
  withLine?: boolean;
  thresholdLine?: number;
  xAxisName?: string;
  yAxisName?: string;
  height?: number;
  showValueLabels?: boolean;
  valueFormatter?: (value: number) => string;
  ariaLabel?: string;
}) {
  const [containerRef, measuredWidth] = useContainerWidth();

  const option = useMemo<EChartsCoreOption>(() => {
    const width = measuredWidth ?? DEFAULT_CHART_WIDTH;
    const legendRow = series.length > 1 || withLine;

    /*
     * Category-label layout responds to the real card width: upright
     * word-wrapped labels while they fit, angled fallback when slots
     * get narrower than the longest word; horizontal bars size the
     * left gutter to the longest label (capped + ellipsis). Data keeps
     * the clean full text, so tooltips never show wrapped/shortened
     * labels.
     */
    const valueGutterLeft = horizontal ? 44 : yAxisName ? 64 : 44;
    const columnLayout = horizontal
      ? null
      : columnCategoryAxis(categories, width - valueGutterLeft - 16);
    const barBottom = (legendRow ? 26 : 0) + 28;
    const barLayout = horizontal
      ? barCategoryAxis(categories, height - 28 - barBottom)
      : null;

    const categoryAxis = {
      type: "category" as const,
      data: categories,
      name: horizontal ? undefined : xAxisName,
      nameLocation: "middle" as const,
      nameGap: (columnLayout?.labelDepth ?? 24) + 8,
      nameTextStyle: { color: INK, fontSize: 10, fontWeight: 600 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: GRID } },
      axisLabel: (horizontal ? barLayout : columnLayout)?.axisLabel ?? {
        ...ECHARTS_AXIS_LABEL,
        interval: 0,
      },
    };
    const valueAxis = {
      type: "value" as const,
      name: yAxisName,
      nameLocation: "middle" as const,
      nameRotate: horizontal ? 0 : 90,
      nameGap: horizontal ? 30 : 46,
      nameTextStyle: { color: INK, fontSize: 10, fontWeight: 600 },
      /* Figma shows plain values (12000, not 12,000). */
      axisLabel: {
        ...ECHARTS_AXIS_LABEL,
        formatter: (value: number) => String(value),
      },
      splitLine: { lineStyle: { color: GRID } },
    };

    const barSeries = series.map((entry, index) => ({
      name: entry.name,
      type: "bar" as const,
      data: entry.data,
      stack: stacked ? "total" : undefined,
      barMaxWidth: 44,
      itemStyle: {
        color: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
        borderRadius: stacked || horizontal ? undefined : ([4, 4, 0, 0] as [number, number, number, number]),
      },
      label:
        showValueLabels && series.length === 1 && !horizontal
          ? {
              show: true,
              position: "top" as const,
              color: INK,
              fontWeight: 700,
              fontSize: 12,
              /* Figma bar labels are plain values (8500, not 8,500). */
              formatter: ({ value }: { value: number }) => String(value),
            }
          : undefined,
      markLine:
        thresholdLine !== undefined && index === 0
          ? {
              silent: true,
              symbol: "none",
              lineStyle: { color: "#e02020", width: 2, type: "solid" as const },
              data: [horizontal ? { xAxis: thresholdLine } : { yAxis: thresholdLine }],
              label: { show: false },
            }
          : undefined,
    }));

    /* Combination chart: a line tracing the first series. */
    const lineOverlay = withLine
      ? [
          {
            name: `${series[0]?.name ?? "Trend"} (line)`,
            type: "line" as const,
            data: series[0]?.data ?? [],
            smooth: true,
            symbolSize: 7,
            itemStyle: { color: CHART_COLORS[3], borderWidth: 2, borderColor: "#fff" },
            lineStyle: { color: CHART_COLORS[3], width: 2.5 },
          },
        ]
      : [];

    return {
      grid: {
        left: horizontal ? (barLayout?.labelDepth ?? 110) : valueGutterLeft,
        right: 16,
        top: 28,
        bottom: horizontal
          ? barBottom
          : (columnLayout?.labelDepth ?? 24) +
            (xAxisName ? 26 : 6) +
            (legendRow ? 26 : 0),
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(0,0,0,0.04)" } },
        ...ECHARTS_TOOLTIP,
        valueFormatter: (value: unknown) =>
          valueFormatter ? valueFormatter(Number(value)) : String(value),
      },
      legend: legendRow ? { bottom: 0, ...ECHARTS_LEGEND } : undefined,
      xAxis: horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : valueAxis,
      series: [...barSeries, ...lineOverlay],
    };
  }, [
    categories,
    series,
    stacked,
    horizontal,
    withLine,
    thresholdLine,
    xAxisName,
    yAxisName,
    height,
    measuredWidth,
    showValueLabels,
    valueFormatter,
  ]);

  return (
    <div ref={containerRef}>
      <EChart option={option} height={height} ariaLabel={ariaLabel} />
    </div>
  );
}
