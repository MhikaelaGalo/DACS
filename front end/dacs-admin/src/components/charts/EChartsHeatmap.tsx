"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  barCategoryAxis,
  columnCategoryAxis,
  DEFAULT_CHART_WIDTH,
  useContainerWidth,
} from "./categoryAxis";
import { ECHARTS_TOOLTIP, INK } from "./ChartTheme";
import { EChart } from "./EChart";

/*
 * DACS heatmap (builder "Heatmap" type): rows × columns grid shaded on
 * a brand-red scale with the value printed in each cell — the ECharts
 * replacement for the old hand-built div grid.
 */
export function EChartsHeatmap({
  rows,
  columns,
  values,
  height = 260,
  ariaLabel,
}: {
  /* y-axis categories (one per row) */
  rows: string[];
  /* x-axis categories (one per column) */
  columns: string[];
  /* values[rowIndex][columnIndex] */
  values: number[][];
  height?: number;
  ariaLabel?: string;
}) {
  const [containerRef, measuredWidth] = useContainerWidth();

  const option = useMemo<EChartsCoreOption>(() => {
    const data: Array<[number, number, number]> = [];
    values.forEach((row, rowIndex) =>
      row.forEach((value, columnIndex) =>
        data.push([columnIndex, rowIndex, value])
      )
    );
    const max = Math.max(1, ...data.map(([, , value]) => value));

    /* Row labels size the left gutter (capped + ellipsis); column
       labels wrap upright or angle when their slots get narrow. */
    const width = measuredWidth ?? DEFAULT_CHART_WIDTH;
    const rowLabels = barCategoryAxis(rows, height - 12 - 56);
    const gridLeft = rowLabels.labelDepth;
    const columnLabels = columnCategoryAxis(columns, width - gridLeft - 16);
    const gridBottom = columnLabels.labelDepth + 34;

    return {
      grid: { left: gridLeft, right: 16, top: 12, bottom: gridBottom },
      tooltip: {
        position: "top",
        ...ECHARTS_TOOLTIP,
        formatter: (params: { value: [number, number, number] }) => {
          const [columnIndex, rowIndex, value] = params.value;
          return `${rows[rowIndex]} · ${columns[columnIndex]}: <b>${value.toLocaleString("en-PH")}</b>`;
        },
      },
      xAxis: {
        type: "category",
        data: columns,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: columnLabels.axisLabel,
      },
      yAxis: {
        type: "category",
        data: rows,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: rowLabels.axisLabel,
      },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemHeight: 90,
        textStyle: { fontSize: 10, color: INK },
        inRange: { color: ["#fbe9e9", "#cc0000"] },
      },
      series: [
        {
          type: "heatmap" as const,
          data,
          label: {
            show: true,
            fontSize: 10,
            formatter: (params: { value: [number, number, number] }) =>
              String(params.value[2]),
          },
          itemStyle: { borderColor: "#ffffff", borderWidth: 2, borderRadius: 3 },
          emphasis: {
            itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.25)" },
          },
        },
      ],
    };
  }, [rows, columns, values, height, measuredWidth]);

  return (
    <div ref={containerRef}>
      <EChart option={option} height={height} ariaLabel={ariaLabel} />
    </div>
  );
}
