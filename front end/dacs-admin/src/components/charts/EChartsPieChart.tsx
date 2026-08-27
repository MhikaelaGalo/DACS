"use client";

import { useMemo } from "react";
import type { EChartsCoreOption } from "echarts/core";

import { CHART_COLORS, ECHARTS_LEGEND, ECHARTS_TOOLTIP } from "./ChartTheme";
import { EChart } from "./EChart";

/*
 * DACS pie / donut chart (builder "Pie Chart" and "Donut Chart"):
 * categorical palette slices, legend at the bottom, tooltip on hover.
 */

export interface EChartsPieDatum {
  name: string;
  value: number;
}

export function EChartsPieChart({
  data,
  donut = false,
  height = 260,
  valueFormatter,
  ariaLabel,
}: {
  data: EChartsPieDatum[];
  donut?: boolean;
  height?: number;
  valueFormatter?: (value: number) => string;
  ariaLabel?: string;
}) {
  const option = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: {
        trigger: "item",
        ...ECHARTS_TOOLTIP,
        valueFormatter: (value: unknown) =>
          valueFormatter ? valueFormatter(Number(value)) : String(value),
      },
      legend: { bottom: 0, type: "scroll", ...ECHARTS_LEGEND },
      color: CHART_COLORS,
      series: [
        {
          type: "pie" as const,
          radius: donut ? ["48%", "74%"] : "74%",
          center: ["50%", "44%"],
          padAngle: donut ? 2 : 0,
          itemStyle: donut ? { borderRadius: 3 } : undefined,
          label: { show: false },
          emphasis: {
            itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.2)" },
          },
          data,
        },
      ],
    }),
    [data, donut, valueFormatter]
  );

  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}
