"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  columnCategoryAxis,
  DEFAULT_CHART_WIDTH,
  useContainerWidth,
} from "./categoryAxis";
import {
  CHART_COLORS,
  ECHARTS_AXIS_LABEL,
  ECHARTS_TOOLTIP,
  GRID,
  INK,
} from "./ChartTheme";
import { EChart } from "./EChart";

/*
 * DACS line chart (Figma "Farmer Engagement"): brand-red line with
 * white dots outlined in red, legend chip at the top right, rotated
 * y-axis title, hairline gridlines. Supports several series for the
 * builder's Line Chart type.
 */

export interface EChartsLineSeries {
  name: string;
  data: number[];
  color?: string;
}

export function EChartsLineChart({
  categories,
  series,
  xAxisName,
  yAxisName,
  height = 260,
  showLegend = true,
  valueFormatter,
  ariaLabel,
}: {
  categories: string[];
  series: EChartsLineSeries[];
  xAxisName?: string;
  yAxisName?: string;
  height?: number;
  showLegend?: boolean;
  valueFormatter?: (value: number) => string;
  ariaLabel?: string;
}) {
  const [containerRef, measuredWidth] = useContainerWidth();

  const option = useMemo<EChartsCoreOption>(() => {
    const width = measuredWidth ?? DEFAULT_CHART_WIDTH;
    const gridLeft = yAxisName ? 64 : 44;
    /* Wrapped upright labels while they fit; angled fallback after. */
    const labels = columnCategoryAxis(categories, width - gridLeft - 16);

    return {
      grid: {
        left: gridLeft,
        right: 16,
        top: showLegend ? 36 : 24,
        bottom: labels.labelDepth + (xAxisName ? 26 : 6),
      },
      tooltip: {
        trigger: "axis",
        ...ECHARTS_TOOLTIP,
        valueFormatter: (value: unknown) =>
          valueFormatter ? valueFormatter(Number(value)) : String(value),
      },
      legend: showLegend
        ? {
            top: 0,
            right: 0,
            icon: "roundRect",
            itemWidth: 18,
            itemHeight: 3,
            textStyle: { fontSize: 11, color: INK },
          }
        : undefined,
      xAxis: {
        type: "category",
        data: categories,
        boundaryGap: false,
        name: xAxisName,
        nameLocation: "middle",
        nameGap: labels.labelDepth + 8,
        nameTextStyle: { color: INK, fontSize: 10, fontWeight: 600 },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: GRID } },
        axisLabel: labels.axisLabel,
      },
      yAxis: {
        type: "value",
        name: yAxisName,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 40,
        nameTextStyle: { color: INK, fontSize: 10, fontWeight: 600 },
        axisLabel: {
          ...ECHARTS_AXIS_LABEL,
          formatter: (value: number) => String(value),
        },
        splitLine: { lineStyle: { color: GRID } },
      },
      series: series.map((entry, index) => ({
        name: entry.name,
        type: "line" as const,
        data: entry.data,
        smooth: false,
        symbol: "circle",
        symbolSize: 8,
        itemStyle: {
          color: "#ffffff",
          borderColor: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
          borderWidth: 2,
        },
        lineStyle: {
          color: entry.color ?? CHART_COLORS[index % CHART_COLORS.length],
          width: 2.5,
        },
        label: {
          show: series.length === 1,
          position: "top" as const,
          color: INK,
          fontSize: 11,
          formatter: ({ value }: { value: number }) => String(value),
        },
      })),
    };
  }, [
    categories,
    series,
    xAxisName,
    yAxisName,
    showLegend,
    measuredWidth,
    valueFormatter,
  ]);

  return (
    <div ref={containerRef}>
      <EChart option={option} height={height} ariaLabel={ariaLabel} />
    </div>
  );
}
