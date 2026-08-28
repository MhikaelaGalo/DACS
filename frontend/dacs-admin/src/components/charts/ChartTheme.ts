/*
 * Validated categorical palette (dataviz six checks, light surface).
 * Series colors follow the entity, assigned in fixed order.
 */
export const CHART_COLORS = ["#cc0000", "#b97d10", "#0e7f63", "#6b5bc9"];

export const INK = "#181818";
export const INK_MUTED = "#6b6b6b";
export const GRID = "#ececec";

export const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #ececec",
  boxShadow: "0px 0px 15px 0px rgba(0,0,0,0.12)",
  fontSize: 13,
  color: INK,
} as const;

/* Shared Apache ECharts styling (mirrors TOOLTIP_STYLE for canvas charts). */
export const ECHARTS_TOOLTIP = {
  backgroundColor: "#ffffff",
  borderColor: GRID,
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: INK, fontSize: 13 },
  extraCssText: "border-radius:12px;box-shadow:0px 0px 15px 0px rgba(0,0,0,0.12);",
} as const;

export const ECHARTS_AXIS_LABEL = { color: INK_MUTED, fontSize: 11 } as const;

export const ECHARTS_LEGEND = {
  icon: "rect",
  itemWidth: 14,
  itemHeight: 10,
  textStyle: { fontSize: 12, color: INK },
} as const;

/* The Figma "Hatch vs Customer Orders" secondary red. */
export const SECONDARY_RED = "#d95c5c";
