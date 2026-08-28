"use client";

import { useEffect, useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

import { ECHARTS_TOOLTIP, INK, SECONDARY_RED } from "./ChartTheme";
import { EChart } from "./EChart";
import { echarts } from "./echarts";

/*
 * "Certification Status by Region" (Figma) as a real ECharts filled
 * map: Philippines province GeoJSON (public/ph-provinces.json,
 * mapshaper-simplified to ~260KB) + registerMap — no hand-drawn map.
 * Provinces are shaded Complete (dark red) / On-going (light red) with
 * the piecewise legend at the top right, as in the Figma frame.
 */

const MAP_NAME = "philippines";
const COMPLETE_VALUE = 2;
const ONGOING_VALUE = 1;

/*
 * Web-Mercator projection (the fitBounds-style approach): ECharts
 * projects every GeoJSON coordinate through this and then auto-fits
 * the projected bounds into the canvas UNIFORMLY, so the archipelago
 * keeps its true shape at any container size. Never position the map
 * with left+right+top+bottom together — that stretches it to fill.
 */
const RAD = Math.PI / 180;
/* Projected y is negated: screen y grows downward, latitude grows north. */
const MERCATOR = {
  project: ([lng, lat]: number[]) => [
    lng * RAD,
    -Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)),
  ],
  unproject: ([x, y]: number[]) => [
    x / RAD,
    (2 * Math.atan(Math.exp(-y)) - Math.PI / 2) / RAD,
  ],
};

let registration: Promise<string[]> | null = null;

/* Fetch + registerMap exactly once; resolves to the province names. */
function ensureMapRegistered(): Promise<string[]> {
  registration ??= fetch("/ph-provinces.json")
    .then((response) => {
      if (!response.ok) throw new Error(`GeoJSON fetch failed: ${response.status}`);
      return response.json();
    })
    .then((geoJson) => {
      echarts.registerMap(MAP_NAME, geoJson);
      return (geoJson.features as Array<{ properties: { PROVINCE: string } }>)
        .map((feature) => feature.properties.PROVINCE)
        .filter(Boolean);
    });
  return registration;
}

export function EChartsPhMap({
  completeProvinces,
  provinceValues,
  valueFormatter,
  height = 420,
  ariaLabel,
}: {
  /* Binary mode: provinces shaded "Complete"; the rest is "On-going". */
  completeProvinces?: string[];
  /*
   * Value mode (Create Visual filled maps): each province shaded by its
   * real aggregated value; provinces with no matching record stay grey
   * and report "No data" — values are never invented.
   */
  provinceValues?: Array<{ name: string; value: number }>;
  valueFormatter?: (value: number) => string;
  height?: number;
  ariaLabel?: string;
}) {
  const [provinceNames, setProvinceNames] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureMapRegistered()
      .then((names) => {
        if (!cancelled) setProvinceNames(names);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const option = useMemo<EChartsCoreOption | null>(() => {
    if (!provinceNames) return null;

    const sharedSeries = {
      type: "map" as const,
      map: MAP_NAME,
      nameProperty: "PROVINCE",
      roam: false,
      selectedMode: false,
      projection: MERCATOR,
      /*
       * Auto-fit + uniform zoom: the projected country is scaled
       * uniformly (correct proportions, centered); 1.18 uses the
       * canvas height fully while keeping ~12px of padding so no
       * island touches an edge. Size comes from the tall canvas —
       * never from stretching.
       */
      zoom: 1.18,
      itemStyle: { borderColor: "#ffffff", borderWidth: 0.6 },
      emphasis: {
        label: { show: false },
        itemStyle: { areaColor: "#7f1414" },
      },
    };

    if (provinceValues) {
      const valueByName = new Map(
        provinceValues.map((entry) => [entry.name, entry.value])
      );
      const max = Math.max(1, ...provinceValues.map((entry) => entry.value));
      const format = (value: number) =>
        valueFormatter ? valueFormatter(value) : String(value);
      return {
        tooltip: {
          trigger: "item",
          ...ECHARTS_TOOLTIP,
          formatter: (params: { name: string; value: number | undefined }) =>
            `${params.name}: <b>${
              params.value === undefined || Number.isNaN(params.value)
                ? "No data"
                : format(params.value)
            }</b>`,
        },
        visualMap: {
          type: "continuous",
          min: 0,
          max,
          calculable: false,
          top: 8,
          right: 8,
          itemWidth: 12,
          itemHeight: 90,
          textStyle: { fontSize: 11, color: INK },
          inRange: { color: [SECONDARY_RED, "#a51d1d"] },
          formatter: (value: number) => format(Math.round(value)),
        },
        series: [
          {
            ...sharedSeries,
            data: provinceNames.map((name) => {
              const value = valueByName.get(name);
              return value === undefined ? { name } : { name, value };
            }),
          },
        ],
      };
    }

    const completeSet = new Set(completeProvinces ?? []);
    return {
      tooltip: {
        trigger: "item",
        ...ECHARTS_TOOLTIP,
        formatter: (params: { name: string; value: number }) =>
          `${params.name}: <b>${
            params.value === COMPLETE_VALUE ? "Complete" : "On-going"
          }</b>`,
      },
      visualMap: {
        type: "piecewise",
        top: 8,
        right: 8,
        itemWidth: 26,
        itemHeight: 12,
        itemGap: 6,
        textStyle: { fontSize: 11, color: INK },
        pieces: [
          { value: COMPLETE_VALUE, label: "Complete", color: "#a51d1d" },
          { value: ONGOING_VALUE, label: "On-going", color: SECONDARY_RED },
        ],
      },
      series: [
        {
          ...sharedSeries,
          data: provinceNames.map((name) => ({
            name,
            value: completeSet.has(name) ? COMPLETE_VALUE : ONGOING_VALUE,
          })),
        },
      ],
    };
  }, [provinceNames, completeProvinces, provinceValues, valueFormatter]);

  if (failed) {
    return (
      <p className="flex h-full items-center justify-center py-16 text-sm text-dacs-muted">
        Map data could not be loaded.
      </p>
    );
  }
  if (!option) {
    return (
      <p className="flex h-full items-center justify-center py-16 text-sm italic text-dacs-muted">
        Loading map…
      </p>
    );
  }
  return <EChart option={option} height={height} ariaLabel={ariaLabel} />;
}
