import type { Prisma } from "../../../generated/prisma/client";

import { prisma } from "../../config/database";
import { recordActivity } from "../../services/activityLog.service";
import { HttpError } from "../../utils/httpError";
import { runAnalyticsQuery, validateCustomVisualConfig } from "../analytics/analytics.catalog";
import type { RequestMeta } from "../auth/auth.service";

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

// Reuse the designated account's existing visual IDs, configuration and order.
const dashboardLayoutEmail = process.env.DACS_TEST_MODE === "1"
  ? "dashboard-layout@dacs-test.example"
  : process.env.DASHBOARD_LAYOUT_EMAIL?.trim() || "lemonyfroggo@gmail.com";

async function layoutAccountId(client: Prisma.TransactionClient) {
  const account = await client.user.findFirst({
    where: { email: { equals: dashboardLayoutEmail, mode: "insensitive" } },
    select: { id: true },
  });
  if (!account) throw new HttpError(503, "The account that holds the shared dashboard could not be found.");
  return account.id;
}

export async function getSharedVisuals() {
  const userId = await layoutAccountId(prisma);
  return prisma.dashboardVisual.findMany({
    where: { userId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getSharedVisualData(visualId: string) {
  const userId = await layoutAccountId(prisma);
  const visual = await prisma.dashboardVisual.findFirst({ where: { userId, id: visualId } });
  if (!visual) throw new HttpError(404, "Dashboard visual was not found.");
  if (visual.builtin || !visual.dataset || !visual.yField) {
    throw new HttpError(400, "This visual has no custom data query.");
  }
  return runAnalyticsQuery({ ...visual, dataset: visual.dataset, yField: visual.yField });
}

async function lockLayout(transaction: Prisma.TransactionClient) {
  const userId = await layoutAccountId(transaction);
  await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  return userId;
}

export async function createVisualOnSharedDashboard(
  actorId: string,
  input: CreateVisualInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const userId = await lockLayout(transaction);
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
      userId: actorId,
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

export async function updateVisualOnSharedDashboard(
  actorId: string,
  visualId: string,
  input: UpdateVisualInput,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const userId = await lockLayout(transaction);
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
      userId: actorId,
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

export async function deleteVisualOnSharedDashboard(
  actorId: string,
  visualId: string,
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const userId = await lockLayout(transaction);
    const existing = await transaction.dashboardVisual.findFirst({
      where: { id: visualId, userId },
    });

    if (!existing) {
      throw new HttpError(404, "Dashboard visual was not found.");
    }

    await transaction.dashboardVisual.delete({ where: { id: existing.id } });

    await recordActivity(transaction, {
      userId: actorId,
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
 * order of the shared visuals, applied atomically.
 */
export async function reorderVisualsOnSharedDashboard(
  actorId: string,
  orderedVisualIds: string[],
  meta: RequestMeta
) {
  return prisma.$transaction(async (transaction) => {
    const userId = await lockLayout(transaction);
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
      userId: actorId,
      module: "DASHBOARD",
      action: "DASHBOARD_VISUALS_REORDERED",
      description: "The dashboard visuals were rearranged.",
      metadata: { visualCount: orderedVisualIds.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return transaction.dashboardVisual.findMany({
      where: { userId },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  });
}
