"use client";

import { useCallback, useEffect, useState } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, X } from "lucide-react";

import { KpiValue, VisualBody } from "@/components/dashboard/ChartRenderer";
import { VisualizationBuilder } from "@/components/dashboard/VisualizationBuilder";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  createDashboardVisual,
  deleteDashboardVisual,
  getDashboardSummary,
  listDashboardVisuals,
  reorderDashboardVisuals,
  toDashboardVisual,
} from "@/lib/api/analytics";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import { useAutoRefresh, type LoadMode } from "@/lib/useAutoRefresh";
import type { DashboardSummary, DashboardVisual } from "@/types/admin";

/*
 * Dashboard (NOTES: page scrolls; charts + KPIs + tables limited to 12).
 * The default layout is the Figma frame: four sales KPIs, monthly
 * sales, hatch vs orders, farmer engagement, vet inventory, and the
 * certification map. "+ Create Visual" opens the Visualization builder;
 * the trash icon enters delete mode (X badge on every visual, confirm
 * popup, "Cancel Delete" to exit).
 *
 * Cards are rearrangeable: each visual has a grip handle (top-right)
 * that drags it to a new position within its row — KPIs reorder among
 * KPIs, charts among charts — with dnd-kit animating the reflow. Only
 * the handle starts a drag, so chart tooltips/zoom keep working.
 *
 * Data source: visual DEFINITIONS live per-user on the backend
 * (/api/dashboard/visuals — a fresh user is seeded with the Figma
 * defaults once); chart/KPI VALUES come live from
 * GET /api/analytics/dashboard.
 */

const MAX_VISUALS = 12;

/*
 * Shipped default layout. Titles state what the backend actually
 * computes: the "Sales" KPIs count PAID orders (payment verified or
 * later), the seminar KPI counts approved certificate requests (DACS
 * records no seminar revenue), and the monthly chart covers the
 * trailing 12 months, not one fixed year.
 */
const EMPTY_FIELDS = {
  dataset: null,
  xField: null,
  xBucket: null,
  yField: null,
  aggregation: null,
  legendField: null,
} as const;

const DEFAULT_VISUALS: DashboardVisual[] = [
  { id: "kpi-ps", type: "kpi", title: "Total # of Sales for PS", ...EMPTY_FIELDS, builtin: "kpi-ps" },
  { id: "kpi-f1", type: "kpi", title: "Total # of Sales for F1", ...EMPTY_FIELDS, builtin: "kpi-f1" },
  { id: "kpi-vet", type: "kpi", title: "Total # of Sales for Vet Products", ...EMPTY_FIELDS, builtin: "kpi-vet" },
  { id: "kpi-seminars", type: "kpi", title: "Seminar Certificates Issued", ...EMPTY_FIELDS, builtin: "kpi-seminars" },
  { id: "monthly-sales", type: "clustered-column", title: "Total # of Sales per Month (Last 12 Months)", ...EMPTY_FIELDS, builtin: "monthly-sales" },
  { id: "hatch-vs-orders", type: "clustered-column", title: "Hatch vs Customer Orders", ...EMPTY_FIELDS, builtin: "hatch-vs-orders" },
  { id: "farmer-engagement", type: "line", title: "Farmer Engagement", ...EMPTY_FIELDS, builtin: "farmer-engagement" },
  { id: "vet-inventory", type: "clustered-column", title: "Vet Products Inventory Levels", ...EMPTY_FIELDS, builtin: "vet-inventory" },
  { id: "cert-map", type: "filled-map", title: "Certification Status by Region", ...EMPTY_FIELDS, builtin: "cert-map" },
];

/*
 * Sortable card wrapper: carries the flex-item sizing classes so the
 * dnd transform moves the whole card, and exposes a grip handle as the
 * only drag activator (charts stay fully interactive).
 */
function SortableVisual({
  visual,
  disabled,
  className,
  children,
}: {
  visual: DashboardVisual;
  disabled: boolean;
  className: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: visual.id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${className} ${isDragging ? "z-30 opacity-90 shadow-2xl" : ""}`}
    >
      {!disabled && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag to rearrange ${visual.title}`}
          title="Drag to rearrange"
          className="absolute right-2 top-2 z-10 cursor-grab touch-none rounded-lg p-1.5 text-dacs-muted hover:bg-dacs-light hover:text-dacs-dark active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
      )}
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const { showToast } = useToast();
  const [visuals, setVisuals] = useState<DashboardVisual[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DashboardVisual | null>(null);
  const [building, setBuilding] = useState(false);
  /* Bumped on refresh so custom visuals re-run their analytics query. */
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    /* Analytics may 403 for IT Staff (visual layouts are per-staff but
       the numbers are Owner/Admin) — the board still renders. */
    const [visualsResult, summaryResult] = await Promise.allSettled([
      listDashboardVisuals(),
      getDashboardSummary(),
    ]);

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
      setAnalyticsError(null);
    } else {
      setAnalyticsError(
        errorMessage(summaryResult.reason, "Unable to load analytics data.")
      );
    }

    if (visualsResult.status === "fulfilled") {
      let list = visualsResult.value;
      if (list.length === 0) {
        /* First visit: provision the Figma default layout server-side. */
        for (const preset of DEFAULT_VISUALS) {
          try {
            await createDashboardVisual({
              visualType: preset.type,
              title: preset.title,
              builtin: preset.builtin,
            });
          } catch {
            break;
          }
        }
        list = await listDashboardVisuals().catch(() => []);
      }
      setVisuals(list.map(toDashboardVisual));
    } else {
      showToast(
        errorMessage(visualsResult.reason, "Unable to load your dashboard layout."),
        "error"
      );
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.visuals);
  }, []);

  /*
   * KPI cards and builtin charts read `summary`; custom visuals query
   * /api/analytics/query keyed on `refreshToken` — refreshing both from
   * the same tick keeps every dashboard number on the same backend
   * snapshot. The visual DEFINITIONS (layout) are per-user and only
   * change through this page's own actions, so they load once.
   */
  const loadDashboard = useCallback(
    async (mode: LoadMode) => {
      if (mode === "initial") {
        await load();
        return;
      }
      try {
        setSummary(await getDashboardSummary());
        setAnalyticsError(null);
      } catch {
        /* Keep the last good numbers; the next tick retries. */
      }
      setRefreshToken((token) => token + 1);
    },
    [load]
  );

  useAutoRefresh(loadDashboard, 15_000);

  const kpis = visuals.filter((visual) => visual.type === "kpi");
  const charts = visuals.filter((visual) => visual.type !== "kpi");

  /* Drags start after 4px of movement, so plain clicks never drag. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function reorder(group: "kpi" | "chart") {
    return ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return;
      const list = group === "kpi" ? kpis : charts;
      const oldIndex = list.findIndex((entry) => entry.id === active.id);
      const newIndex = list.findIndex((entry) => entry.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const moved = arrayMove(list, oldIndex, newIndex);
      const previous = visuals;
      const next = group === "kpi" ? [...moved, ...charts] : [...kpis, ...moved];
      setVisuals(next);
      void reorderDashboardVisuals(next.map((entry) => entry.id))
        .then(() => {
          appendAudit("Dashboard", "VISUAL_LAYOUT_SAVED", "Rearranged the dashboard visuals.");
          showToast("Dashboard layout saved.");
        })
        .catch((error) => {
          setVisuals(previous);
          showToast(
            errorMessage(error, "Unable to save the layout. Please try again."),
            "error"
          );
        });
    };
  }

  async function removeVisual(visual: DashboardVisual) {
    try {
      await deleteDashboardVisual(visual.id);
      setVisuals((current) => current.filter((entry) => entry.id !== visual.id));
      appendAudit("Dashboard", "VISUAL_DELETED", `Deleted visual "${visual.title}".`);
      showToast("Visual deleted successfully.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to delete this visual. Please try again."),
        "error"
      );
    } finally {
      setPendingDelete(null);
    }
  }

  async function addVisual(visual: DashboardVisual) {
    try {
      const created = await createDashboardVisual({
        visualType: visual.type,
        title: visual.title,
        dataset: visual.dataset,
        xField: visual.xField,
        xBucket: visual.xBucket,
        yField: visual.yField,
        aggregation: visual.aggregation,
        legendField: visual.legendField,
      });
      setVisuals((current) => [...current, toDashboardVisual(created)]);
      setBuilding(false);
      appendAudit("Dashboard", "VISUAL_CREATED", `Created visual "${visual.title}".`);
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to create this visual. Please try again."),
        "error"
      );
    }
  }

  const DeleteBadge = ({ visual }: { visual: DashboardVisual }) =>
    deleteMode ? (
      <button
        type="button"
        aria-label={`Delete ${visual.title}`}
        onClick={() => setPendingDelete(visual)}
        className="absolute -left-2 -top-2 z-10 rounded-full border border-dacs-light bg-white p-1.5 shadow-dacs-card hover:bg-red-50"
      >
        <X size={16} className="text-dacs-dark" />
      </button>
    ) : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-8">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Dashboard</h1>
        <div className="flex items-center gap-4">
          {deleteMode ? (
            <button
              type="button"
              onClick={() => setDeleteMode(false)}
              className="rounded-2xl border border-dacs-dark px-7 py-3.5 font-semibold hover:bg-dacs-light/60"
            >
              Cancel Delete
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label="Delete visuals"
                onClick={() => setDeleteMode(true)}
                className="rounded-full p-2 text-dacs-dark hover:bg-dacs-light"
              >
                <Trash2 size={24} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (visuals.length >= MAX_VISUALS) {
                    showToast(
                      `The dashboard is limited to ${MAX_VISUALS} visuals. Delete one first.`,
                      "error"
                    );
                    return;
                  }
                  setBuilding(true);
                }}
                className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-7 py-3.5 font-semibold text-white hover:opacity-90"
              >
                <Plus size={18} />
                Create Visual
              </button>
            </>
          )}
        </div>
      </div>

      {analyticsError && (
        <p className="mb-6 rounded-dacs-card border border-dashed border-dacs-dark/30 px-6 py-4 text-center text-sm text-dacs-muted">
          {analyticsError}
        </p>
      )}

      {loading && (
        <p className="py-20 text-center text-dacs-muted">Loading dashboard…</p>
      )}

      {/*
       * Both rows use centered flex-wrap so deleting a visual reflows
       * the remaining cards toward the center instead of leaving an
       * empty grid cell behind. KPIs and charts are separate sortable
       * rows so a small KPI tile can never land inside the chart grid.
       */}
      {!loading && kpis.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={reorder("kpi")}
        >
          <SortableContext items={kpis.map((visual) => visual.id)} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap justify-center gap-6">
              {kpis.map((visual) => (
                <SortableVisual
                  key={visual.id}
                  visual={visual}
                  disabled={deleteMode}
                  className="relative min-w-[220px] max-w-[360px] flex-1"
                >
                  <DeleteBadge visual={visual} />
                  <KpiValue
                    visual={visual}
                    summary={summary}
                    refreshToken={refreshToken}
                  />
                </SortableVisual>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Chart cards */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorder("chart")}
      >
        <SortableContext items={charts.map((visual) => visual.id)} strategy={rectSortingStrategy}>
          <div className="mt-6 flex flex-wrap justify-center gap-6">
            {charts.map((visual) => (
              <SortableVisual
                key={visual.id}
                visual={visual}
                disabled={deleteMode}
                className="relative w-full min-w-0 rounded-dacs-card bg-white p-4 shadow-dacs-card sm:p-6 xl:w-[calc(50%-12px)]"
              >
                <DeleteBadge visual={visual} />
                <h2 className="mb-4 text-center text-lg font-bold">{visual.title}</h2>
                <VisualBody
                  visual={visual}
                  summary={summary}
                  refreshToken={refreshToken}
                />
              </SortableVisual>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {!loading && visuals.length === 0 && (
        <p className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-24 text-center text-dacs-muted">
          No visuals on the dashboard. Click “+ Create Visual” to add one.
        </p>
      )}

      {building && (
        <VisualizationBuilder
          onCreate={addVisual}
          onCancel={() => setBuilding(false)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          message="Are you sure you want to delete?"
          onConfirm={() => void removeVisual(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
