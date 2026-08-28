import { api, ApiError } from "@/lib/api";
import {
  fetchSeminarViews,
  SEMINAR_SEQUENCE,
  setActiveSeminarId,
  type SeminarSequenceId,
} from "@/services/seminar.service";
import { ROUTES } from "@/constants/routes";

export type ModuleProgressLabel =
  | "Completed"
  | "In Progress"
  | "Not Started"
  | "Locked";

export interface ModuleProgressEntry {
  id: SeminarSequenceId;
  /** Short display name, e.g. "Module 1". */
  name: string;
  title: string;
  label: ModuleProgressLabel;
  unlocked: boolean;
  completed: boolean;
}

export interface SeminarEligibility {
  module1Completed: boolean;
  module2Completed: boolean;
  module3Completed: boolean;
  /** Sequential unlock state per module id. */
  unlocked: Record<SeminarSequenceId, boolean>;
  /** True once Modules 1, 2 and 3 are all completed in order. */
  chickOrderingEligible: boolean;
  /** Earliest module that still needs completing (null when all done). */
  nextRequiredModule: SeminarSequenceId | null;
  /** Display rows for the locked-order notice, in module order. */
  progress: ModuleProgressEntry[];
}

/** Chick-related categories require full seminar completion; VP does not. */
export function isChickCategory(category: string): boolean {
  return category === "PS" || category === "F1";
}

/* GET /api/seminars/me/progress -> data */
interface ApiProgressModule {
  moduleId: string;
  moduleNumber: number;
  title: string;
  started: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

interface ApiMyProgress {
  modules: ApiProgressModule[];
  completedRequiredModules: number;
  requiredModuleNumbers: number[];
  parentStockUnlocked: boolean;
}

/**
 * SERVER-TRUTH eligibility from GET /api/seminars/me/progress — the same
 * data the backend's own Parent Stock order gate uses, so the UI locks
 * can never disagree with the 409 the server would return. Farmers
 * without a customer profile yet (404) are simply not eligible.
 *
 * The strict Module 1 -> 2 -> 3 unlock order remains a client-side UX
 * rule (the backend allows any published module in any order).
 */
export async function fetchSeminarEligibility(): Promise<SeminarEligibility> {
  let progress: ApiMyProgress | null = null;
  try {
    const response = await api.get<{ data: ApiMyProgress }>(
      "/api/seminars/me/progress"
    );
    progress = response.data;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  const byNumber = new Map<number, ApiProgressModule>();
  for (const moduleEntry of progress?.modules ?? []) {
    byNumber.set(moduleEntry.moduleNumber, moduleEntry);
  }
  const completed = [1, 2, 3].map(
    (moduleNumber) => byNumber.get(moduleNumber)?.completedAt != null
  );
  const unlocked: Record<SeminarSequenceId, boolean> = {
    "module-1": true,
    "module-2": completed[0],
    "module-3": completed[0] && completed[1],
  };
  const nextRequiredModule =
    SEMINAR_SEQUENCE.find((_, index) => !completed[index]) ?? null;

  const progressRows: ModuleProgressEntry[] = SEMINAR_SEQUENCE.map(
    (id, index) => {
      const moduleEntry = byNumber.get(index + 1);
      let label: ModuleProgressLabel;
      if (completed[index]) label = "Completed";
      else if (!unlocked[id]) label = "Locked";
      else if (moduleEntry?.started) label = "In Progress";
      else label = "Not Started";
      return {
        id,
        name: `Module ${index + 1}`,
        title: moduleEntry?.title ?? `Module ${index + 1}`,
        label,
        unlocked: unlocked[id],
        completed: completed[index],
      };
    }
  );

  return {
    module1Completed: completed[0],
    module2Completed: completed[1],
    module3Completed: completed[2],
    unlocked,
    chickOrderingEligible: progress?.parentStockUnlocked ?? false,
    nextRequiredModule,
    progress: progressRows,
  };
}

/**
 * Destination for a "Continue Seminar" action: opens the earliest
 * incomplete unlocked module's video flow (making it the active
 * seminar), or the Seminars page when the farmer has not enrolled yet.
 */
export async function continueSeminarHref(): Promise<string> {
  const [eligibility, views] = await Promise.all([
    fetchSeminarEligibility(),
    fetchSeminarViews(),
  ]);
  const { nextRequiredModule } = eligibility;
  if (!nextRequiredModule) return ROUTES.seminars;
  const view = views.find((entry) => entry.id === nextRequiredModule);
  if (!view || !view.started) return ROUTES.seminars;
  setActiveSeminarId(nextRequiredModule);
  return "/seminars/modules/1";
}
