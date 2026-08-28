/*
 * Central Apache ECharts configuration (tree-shaken modular build).
 *
 * Every chart type / component the app uses must be registered here
 * once — importing `echarts` from this file everywhere else keeps the
 * bundle small and the setup in one place.
 *
 * Migration roadmap:
 *   [x] Bar/Column charts        -> BarChart
 *   [x] Stacked charts          -> BarChart (stack option)
 *   [x] Line charts             -> LineChart
 *   [x] Pie/Donut charts        -> PieChart
 *   [x] Combination charts      -> BarChart + LineChart
 *   [x] Heatmaps                -> HeatmapChart + VisualMapComponent
 *   [x] PH Filled Map           -> MapChart + registerMap(GeoJSON)
 *   [ ] Values from DACS backend API (mock payloads are drop-in shaped)
 */
import * as echarts from "echarts/core";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  MapChart,
  PieChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  MapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export { echarts };
