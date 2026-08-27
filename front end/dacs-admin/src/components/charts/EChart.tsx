"use client";

import { useEffect, useRef } from "react";
import type { EChartsCoreOption, ECharts } from "echarts/core";

import { echarts } from "./echarts";

/*
 * Base ECharts wrapper: every DACS chart renders through this.
 * Handles init on mount, notMerge option updates, container resize
 * (ResizeObserver) and dispose on unmount. Chart-type components
 * (EChartsBarChart, later line/pie/heatmap/map) only build options.
 */
export function EChart({
  option,
  height = 260,
  ariaLabel,
}: {
  option: EChartsCoreOption;
  height?: number;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container);
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height }}
    />
  );
}
