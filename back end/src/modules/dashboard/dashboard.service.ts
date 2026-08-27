import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import { validateCustomVisualConfig } from "../analytics/analytics.catalog";
import type { RequestMeta } from "../auth/auth.service";

/*
 * Dashboard visual DEFINITIONS (Requirement 11's "Create Visual"
 * builder + the shipped default charts). Each staff user manages their
 * own layout, matching the frontend's per-browser behavior. Only the
 * configuration is stored — the analytics endpoints compute the actual
 * chart data live whenever a visual renders.
 */

/* The builder's chart types, mirrored from the admin frontend. */
export const VISUAL_TYPES = [
  "clustered-bar",
  "clustered-column",
  "stacked-bar",
  "stacked-column",
  "line",
  "line-clustered-column",
  "line-stacked-column",
  "pie",
  "donut",
  "kpi",
  "table",
  "filled-map",
  "heatmap",
] as const;

export type VisualType = (typeof VISUAL_TYPES)[number];

/* The dashboard page allows at most 12 visuals (frontend rule). */
export const MAX_DASHBOARD_VISUALS = 12;

export interface CreateVisualInput {
  visualType: VisualType;
  title: string;
  dataset?: string | null;
  xField?: string | null;
  xBucket?: string | null;
  yField?: string | null;
  aggregation?: string | null;
  legendField?: string | null;
  builtin?: string | null;
}

export interface UpdateVisualInput {
  visualType?: VisualType;
  title?: string;
  dataset?: string | null;
  xField?: string | null;
  xBucket?: string | null;
  yField?: string | null;
  aggregation?: string | null;
  legendField?: string | null;
}

/*
 * Custom visuals must reference real backend analytics fields: the
 * catalog validates dataset/field/aggregation membership plus the
 * per-chart-type requirements, and returns the normalized picks
 * (defaulted aggregation and date bucket) to persist. Built-in visuals
 * render from the app's fixed chart registry and carry no field picks.
 */
function normalizeConfiguration(visual: {
  visualType: string;
  dataset: string | null;
  xField: string | null;
  xBucket: string | null;
  yField: string | null;
  aggregation: string | null;
  legendField: string | null;
  builtin: string | null;
}) {
  if (visual.builtin) {
    return {
      dataset: null,
      xField: null,
      xBucket: null,
      yField: null,
      aggregation: null,
      legendField: null,
    };
  }
  return validateCustomVisualConfig(visual);
}

export async function getVisualsForUser(userId: string) {
  return prisma.dashboardVisual.findMany({
    where: { userId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createVisualForUser(
  userId: string,
  input: CreateVisualInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existingCount = await transaction.dashboardVisual.count({
      where: { userId },
    });

    if (existingCount >= MAX_DASHBOARD_VISUALS) {
      throw new HttpError(
        409,
        `The dashboard is limited to ${MAX_DASHBOARD_VISUALS} visuals. Delete one first.`
      );
    }

    const normalized = normalizeConfiguration({
      visualType: input.visualType,
      dataset: input.dataset ?? null,
      xField: input.xField ?? null,
      xBucket: input.xBucket ?? null,
      yField: input.yField ?? null,
      aggregation: input.aggregation ?? null,
      legendField: input.legendField ?? null,
      builtin: input.builtin ?? null,
    });

    const lastVisual = await transaction.dashboardVisual.findFirst({
      where: { userId },
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });

    const visual = await transaction.dashboardVisual.create({
      data: {
        userId,
        visualType: input.visualType,
        title: input.title,
        ...normalized,
        builtin: input.builtin ?? null,
        displayOrder: (lastVisual?.displayOrder ?? 0) + 1,
      },
    });

    await recordActivity(transaction, {
      userId,
      module: "DASHBOARD",
      action: "DASHBOARD_VISUAL_CREATED",
      description: `Dashboard visual "${visual.title}" was created.`,
      recordType: "DashboardVisual",
      recordId: visual.id,
      metadata: { visualType: visual.visualType },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return visual;
  });
}

export async function updateVisualForUser(
  userId: string,
  visualId: string,
  input: UpdateVisualInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    /*
     * Ownership by combined query: another user's visual and a missing
     * one both come back 404, so layouts cannot be probed or modified
     * across accounts.
     */
    const existing = await transaction.dashboardVisual.findFirst({
      where: { id: visualId, userId },
    });

    if (!existing) {
      throw new HttpError(404, "Dashboard visual was not found.");
    }

    const data: Prisma.DashboardVisualUpdateInput = {};
    if (input.visualType !== undefined) data.visualType = input.visualType;
    if (input.title !== undefined) data.title = input.title;
    if (input.dataset !== undefined) data.dataset = input.dataset;
    if (input.xField !== undefined) data.xField = input.xField;
    if (input.xBucket !== undefined) data.xBucket = input.xBucket;
    if (input.yField !== undefined) data.yField = input.yField;
    if (input.aggregation !== undefined) data.aggregation = input.aggregation;
    if (input.legendField !== undefined) data.legendField = input.legendField;

    if (Object.keys(data).length === 0) {
      throw new HttpError(400, "No editable fields were provided.");
    }

    /*
     * The EFFECTIVE configuration must stay valid against the catalog,
     * and the normalized picks are what gets stored (so e.g. a date
     * bucket never survives a switch to a category X field). A legacy
     * sample-data visual therefore cannot be patched piecemeal — it
     * has to be given a full backend-field configuration.
     */
    const normalized = normalizeConfiguration({
      visualType: (input.visualType ?? existing.visualType) as string,
      dataset: input.dataset !== undefined ? input.dataset : existing.dataset,
      xField: input.xField !== undefined ? input.xField : existing.xField,
      xBucket: input.xBucket !== undefined ? input.xBucket : existing.xBucket,
      yField: input.yField !== undefined ? input.yField : existing.yField,
      aggregation:
        input.aggregation !== undefined
          ? input.aggregation
          : existing.aggregation,
      legendField:
        input.legendField !== undefined
          ? input.legendField
          : existing.legendField,
      builtin: existing.builtin,
    });

    const visual = await transaction.dashboardVisual.update({
      where: { id: existing.id },
      data: { ...data, ...normalized },
    });

    await recordActivity(transaction, {
      userId,
      module: "DASHBOARD",
      action: "DASHBOARD_VISUAL_UPDATED",
      description: `Dashboard visual "${visual.title}" was updated.`,
      recordType: "DashboardVisual",
      recordId: visual.id,
      metadata: { updatedFields: Object.keys(data) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return visual;
  });
}

export async function deleteVisualForUser(
  userId: string,
  visualId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.dashboardVisual.findFirst({
      where: { id: visualId, userId },
    });

    if (!existing) {
      throw new HttpError(404, "Dashboard visual was not found.");
    }

    // Pure per-user configuration with no history value: a hard delete,
    // matching the frontend's delete-mode contract.
    await transaction.dashboardVisual.delete({ where: { id: existing.id } });

    await recordActivity(transaction, {
      userId,
      module: "DASHBOARD",
      action: "DASHBOARD_VISUAL_DELETED",
      description: `Dashboard visual "${existing.title}" was deleted.`,
      recordType: "DashboardVisual",
      recordId: existing.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return existing;
  });
}

/*
 * Reordering follows the FAQ contract: the request is the full desired
 * order of the user's visuals, applied atomically.
 */
export async function reorderVisualsForUser(
  userId: string,
  orderedVisualIds: string[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const visuals = await transaction.dashboardVisual.findMany({
      where: { userId },
      select: { id: true },
    });

    const uniqueIds = new Set(orderedVisualIds);

    if (
      uniqueIds.size !== orderedVisualIds.length ||
      visuals.length !== orderedVisualIds.length ||
      !visuals.every((visual) => uniqueIds.has(visual.id))
    ) {
      throw new HttpError(
        400,
        "The reorder list must contain every dashboard visual exactly once."
      );
    }

    for (const [index, visualId] of orderedVisualIds.entries()) {
      await transaction.dashboardVisual.update({
        where: { id: visualId },
        data: { displayOrder: index + 1 },
      });
    }

    await recordActivity(transaction, {
      userId,
      module: "DASHBOARD",
      action: "DASHBOARD_VISUALS_REORDERED",
      description: "The dashboard visuals were rearranged.",
      metadata: { visualCount: orderedVisualIds.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.dashboardVisual.findMany({
      where: { userId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    });
  });
}
