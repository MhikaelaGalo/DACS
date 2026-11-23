/* Staff read the shared board. The Dashboard edit grant controls the builder and writes. */
import { api } from "../api";
import type {
  AnalyticsFieldCatalog,
  AnalyticsQueryResult,
  DashboardSummary,
  DashboardVisual,
  VisualType,
} from "@/types/admin";

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await api.get<{ data: DashboardSummary }>(
    "/api/dashboard/summary"
  );
  return response.data;
}

/*
 * The Create Visual field catalog: every data source with its
 * dimensions, measures and allowed aggregations, straight from the
 * backend allowlist — the builder never invents fields.
 */
export async function getAnalyticsFields(): Promise<AnalyticsFieldCatalog> {
  const response = await api.get<{ data: AnalyticsFieldCatalog }>(
    "/api/dashboard/fields"
  );
  return response.data;
}

export interface AnalyticsQueryParams {
  dataset: string;
  xField?: string | null;
  xBucket?: string | null;
  yField: string;
  aggregation?: string | null;
  legendField?: string | null;
}

/*
 * One aggregated series for a custom visual, computed by PostgreSQL —
 * only the grouped rows travel to the browser.
 */
export async function runAnalyticsQuery(
  params: AnalyticsQueryParams
): Promise<AnalyticsQueryResult> {
  const response = await api.get<{ data: AnalyticsQueryResult }>(
    "/api/dashboard/preview",
    {
      dataset: params.dataset,
      xField: params.xField ?? undefined,
      xBucket: params.xBucket ?? undefined,
      yField: params.yField,
      aggregation: params.aggregation ?? undefined,
      legendField: params.legendField ?? undefined,
    }
  );
  return response.data;
}

export interface ApiDashboardVisual {
  id: string;
  userId: string;
  visualType: string;
  title: string;
  dataset: string | null;
  xField: string | null;
  xBucket: string | null;
  yField: string | null;
  aggregation: string | null;
  legendField: string | null;
  builtin: string | null;
  displayOrder: number;
}

export function toDashboardVisual(visual: ApiDashboardVisual): DashboardVisual {
  return {
    id: visual.id,
    type: visual.visualType as VisualType,
    title: visual.title,
    dataset: visual.dataset,
    xField: visual.xField,
    xBucket: visual.xBucket,
    yField: visual.yField,
    aggregation: visual.aggregation,
    legendField: visual.legendField,
    ...(visual.builtin ? { builtin: visual.builtin } : {}),
  };
}

export function listDashboardVisuals() {
  return api.get<{ data: ApiDashboardVisual[] }>("/api/dashboard/visuals");
}

export async function getSavedVisualData(id: string): Promise<AnalyticsQueryResult> {
  const response = await api.get<{ data: AnalyticsQueryResult }>(`/api/dashboard/visuals/${id}/data`);
  return response.data;
}

export async function createDashboardVisual(input: {
  visualType: string;
  title: string;
  dataset?: string | null;
  xField?: string | null;
  xBucket?: string | null;
  yField?: string | null;
  aggregation?: string | null;
  legendField?: string | null;
  builtin?: string | null;
}): Promise<ApiDashboardVisual> {
  const response = await api.post<{ data: ApiDashboardVisual }>(
    "/api/dashboard/visuals",
    input
  );
  return response.data;
}

export async function reorderDashboardVisuals(
  orderedVisualIds: string[]
): Promise<ApiDashboardVisual[]> {
  const response = await api.patch<{ data: ApiDashboardVisual[] }>(
    "/api/dashboard/visuals/reorder",
    { orderedVisualIds }
  );
  return response.data;
}

export async function deleteDashboardVisual(visualId: string): Promise<void> {
  await api.del(`/api/dashboard/visuals/${visualId}`);
}
