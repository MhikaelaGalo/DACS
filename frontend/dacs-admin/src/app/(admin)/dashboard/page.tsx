"use client";

import { useCallback, useContext, useRef, useState } from "react";
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
import { DashboardEditingContext } from "@/lib/permissions";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
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
 * All staff use the shared server layout. The Dashboard edit grant
 * determines who can change it.
 */

const MAX_VISUALS = 12;

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
  const canEdit = useContext(DashboardEditingContext);
  // A grant change also closes open editors and cancels any active drag.
  return <Dashboard key={canEdit ? "editable" : "view-only"} canEdit={canEdit} />;
}

function Dashboard({ canEdit }: { canEdit: boolean }) {
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
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editInFlight = useRef(false);
  const readVersion = useRef(0);

  const loadLayout = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const { data } = await listDashboardVisuals();
      if (version !== readVersion.current) return;
      setVisuals(data.map(toDashboardVisual));
      setLayoutError(null);
    } catch (error) {
      if (version === readVersion.current) {
        setLayoutError(errorMessage(error, "Unable to load the shared dashboard layout."));
      }
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, []);

  useAutoRefresh(async (mode) => {
    const layout = editInFlight.current ? undefined : loadLayout();
    try {
      const next = await getDashboardSummary();
      setSummary((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setAnalyticsError(null);
    } catch (error) {
      if (mode === "initial") {
        setAnalyticsError(errorMessage(error, "Unable to load analytics data."));
      }
    }
    if (mode === "refresh") setRefreshToken((token) => token + 1);
    await layout;
  }, 15_000);

  async function saveLayout(change: () => Promise<void>) {
    if (!canEdit || editInFlight.current) return;
    editInFlight.current = true;
    ++readVersion.current;
    setSaving(true);
    try {
      await change();
    } catch (error) {
      showToast(errorMessage(error, "Unable to save the shared dashboard."), "error");
    } finally {
      // Reload after success or conflict so edits from other accounts remain visible.
      await loadLayout();
      editInFlight.current = false;
      setSaving(false);
    }
  }

  const kpis = visuals.filter((visual) => visual.type === "kpi");
  const charts = visuals.filter((visual) => visual.type !== "kpi");

  /* Drags start after 4px of movement, so plain clicks never drag. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function reorder(group: "kpi" | "chart", { active, over }: DragEndEvent) {
    if (!canEdit || !over || active.id === over.id) return;
    const list = group === "kpi" ? kpis : charts;
    const oldIndex = list.findIndex((entry) => entry.id === active.id);
    const newIndex = list.findIndex((entry) => entry.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(list, oldIndex, newIndex);
    const next = group === "kpi" ? [...moved, ...charts] : [...kpis, ...moved];
    void saveLayout(async () => {
      await reorderDashboardVisuals(next.map((entry) => entry.id));
      appendAudit("Dashboard", "VISUAL_LAYOUT_SAVED", "Rearranged the dashboard visuals.");
      showToast("Dashboard layout saved.");
    });
  }

  async function removeVisual(visual: DashboardVisual) {
    await saveLayout(async () => {
      await deleteDashboardVisual(visual.id);
      appendAudit("Dashboard", "VISUAL_DELETED", `Deleted visual "${visual.title}".`);
      showToast("Visual deleted successfully.");
    });
    setPendingDelete(null);
  }

  async function addVisual(visual: DashboardVisual) {
    await saveLayout(async () => {
      await createDashboardVisual({
        visualType: visual.type,
        title: visual.title,
        dataset: visual.dataset,
        xField: visual.xField,
        xBucket: visual.xBucket,
        yField: visual.yField,
        aggregation: visual.aggregation,
        legendField: visual.legendField,
      });
      setBuilding(false);
      appendAudit("Dashboard", "VISUAL_CREATED", `Created visual "${visual.title}".`);
    });
  }

  function deleteBadge(visual: DashboardVisual) {
    return canEdit && deleteMode ? (
      <button
        type="button"
        aria-label={`Delete ${visual.title}`}
        onClick={() => setPendingDelete(visual)}
        className="absolute -left-2 -top-2 z-10 rounded-full border border-dacs-light bg-white p-1.5 shadow-dacs-card hover:bg-red-50"
      >
        <X size={16} className="text-dacs-dark" />
      </button>
    ) : null;
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-8">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Dashboard</h1>
        {canEdit && !loading && !layoutError && <div className="flex items-center gap-4">
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
        </div>}
      </div>

      {(layoutError || analyticsError) && (
        <p className="mb-6 rounded-dacs-card border border-dashed border-dacs-dark/30 px-6 py-4 text-center text-sm text-dacs-muted">
          {layoutError || analyticsError}
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
          onDragEnd={(event) => reorder("kpi", event)}
        >
          <SortableContext items={kpis.map((visual) => visual.id)} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap justify-center gap-6">
              {kpis.map((visual) => (
                <SortableVisual
                  key={visual.id}
                  visual={visual}
                  disabled={!canEdit || saving || deleteMode}
                  className="relative min-w-[220px] max-w-[360px] flex-1"
                >
                  {deleteBadge(visual)}
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
        onDragEnd={(event) => reorder("chart", event)}
      >
        <SortableContext items={charts.map((visual) => visual.id)} strategy={rectSortingStrategy}>
          <div className="mt-6 flex flex-wrap justify-center gap-6">
            {charts.map((visual) => (
              <SortableVisual
                key={visual.id}
                visual={visual}
                disabled={!canEdit || saving || deleteMode}
                className="relative w-full min-w-0 rounded-dacs-card bg-white p-4 shadow-dacs-card sm:p-6 xl:w-[calc(50%-12px)]"
              >
                {deleteBadge(visual)}
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

      {!loading && !layoutError && visuals.length === 0 && (
        <p className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-24 text-center text-dacs-muted">
          No visuals on the dashboard.{canEdit && " Click + Create Visual to add one."}
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
