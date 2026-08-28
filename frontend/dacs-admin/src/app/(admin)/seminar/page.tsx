"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Award, HelpCircle, Plus, Trash2, Video } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  addSeminarQuestion,
  createSeminarModule,
  deleteSeminarModule,
  listSeminarModules,
  type ApiSeminarModule,
} from "@/lib/api/seminars";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { SeminarModuleSummary } from "@/types/admin";

/*
 * Seminar module list. "+ Create Module" creates a draft module (the
 * Figma "Module Title" empty-editor state) and opens it in edit mode.
 * Each card has a delete action behind a confirmation dialog.
 *
 * Data source: the DACS backend (GET/POST/DELETE /api/seminars/
 * modules). Modules the backend archived instead of deleting (they had
 * farmer enrollments) are hidden from this list — their history stays
 * in the database.
 */

function toSummary(module: ApiSeminarModule): SeminarModuleSummary {
  return {
    id: module.id,
    moduleNumber: module.moduleNumber,
    title: module.title,
    description: module.description ?? "",
    videoCount: module.videos.length,
    questionCount: module._count?.questions ?? 0,
    passingScore: module.passingScore,
    price: Number(module.price ?? 0),
    isPublished: module.isPublished,
    hasUnpublishedChanges: module.hasUnpublishedChanges,
  };
}

/* The official module titles carry their own "Module N:" prefix; only
   prepend one for titles that lack it (e.g. fresh drafts), so labels
   never read "Module 1: Module 1: …". */
function moduleLabel(moduleNumber: number, title: string): string {
  const prefix = `Module ${moduleNumber}:`;
  return title.startsWith(prefix) ? title : `${prefix} ${title}`;
}

export default function SeminarPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [modules, setModules] = useState<SeminarModuleSummary[]>([]);
  /* Archived modules stay hidden but their numbers remain taken. */
  const [takenNumbers, setTakenNumbers] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SeminarModuleSummary | null>(
    null
  );

  const refresh = useCallback(async () => {
    try {
      const data = await listSeminarModules();
      setModules(data.filter((entry) => !entry.archivedAt).map(toSummary));
      setTakenNumbers(data.map((entry) => entry.moduleNumber));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        errorMessage(error, "Unable to load seminar modules. Please try again.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock key. */
    removeStorage(STORAGE_KEYS.modules);
    void refresh();
  }, [refresh]);

  async function createModule() {
    if (creating) return;
    setCreating(true);
    try {
      const nextNumber = Math.max(0, ...takenNumbers) + 1;
      const created = await createSeminarModule({
        moduleNumber: nextNumber,
        title: "Module Title",
        passingScore: 70,
      });
      /* Same starter question the mock editor seeded, now server-side. */
      await addSeminarQuestion(created.id, {
        questionText: "Question #1",
        choices: [
          { choiceText: "Answer A", isCorrect: true },
          { choiceText: "Answer B", isCorrect: false },
          { choiceText: "Answer C", isCorrect: false },
          { choiceText: "Answer D", isCorrect: false },
        ],
      });
      appendAudit(
        "Seminars",
        "SEMINAR_MODULE_CREATED",
        `Created Module ${nextNumber}.`
      );
      router.push(`/seminar/${nextNumber}?edit=1`);
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to create a module. Please try again."),
        "error"
      );
      setCreating(false);
    }
  }

  async function deleteModule(target: SeminarModuleSummary) {
    if (!target.id || deleting) return;
    setDeleting(true);
    try {
      const outcome = await deleteSeminarModule(target.id);
      appendAudit(
        "Seminars",
        outcome.result === "DELETED"
          ? "SEMINAR_MODULE_DELETED"
          : "SEMINAR_MODULE_ARCHIVED",
        `Deleted ${moduleLabel(target.moduleNumber, target.title)}.`
      );
      showToast(
        outcome.result === "DELETED"
          ? "Seminar deleted successfully."
          : "Seminar archived — enrolled farmers keep their records."
      );
      await refresh();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to delete this seminar. Please try again."),
        "error"
      );
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-8">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Seminar</h1>
        <button
          type="button"
          disabled={creating}
          onClick={() => void createModule()}
          className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-7 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          <Plus size={18} />
          {creating ? "Creating…" : "Create Module"}
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {loading && (
          <p className="py-16 text-center text-sm text-dacs-muted">
            Loading seminar modules…
          </p>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center gap-3 rounded-dacs-card border border-dashed border-dacs-dark/30 py-16 text-center">
            <p className="text-dacs-muted">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
            >
              Try Again
            </button>
          </div>
        )}

        {!loading &&
          !loadError &&
          modules.map((module) => (
            <section
              key={module.moduleNumber}
              className="rounded-dacs-card bg-white p-8 shadow-dacs-card"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <h2 className="min-w-0 break-words text-xl font-bold sm:text-2xl">
                  {moduleLabel(module.moduleNumber, module.title)}
                </h2>
                <div className="flex shrink-0 items-center gap-3">
                  <Link
                    href={`/seminar/${module.moduleNumber}`}
                    className="font-semibold text-dacs-red hover:underline"
                  >
                    View Module &gt;
                  </Link>
                  <button
                    type="button"
                    aria-label={`Delete ${moduleLabel(module.moduleNumber, module.title)}`}
                    title="Delete seminar"
                    onClick={() => setPendingDelete(module)}
                    className="rounded-lg p-1.5 text-dacs-muted hover:bg-red-50 hover:text-dacs-red"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-dacs-muted">
                <span className="flex items-center gap-2">
                  <Video size={18} />
                  {module.videoCount} Videos
                </span>
                <span className="flex items-center gap-2">
                  <HelpCircle size={18} />
                  {module.questionCount} Questions
                </span>
                <span className="flex items-center gap-2">
                  <Award size={18} />
                  Certificate
                </span>
                <span>Passing Grade: {module.passingScore}%</span>
                <span
                  className={
                    module.price > 0 ? "font-semibold text-dacs-red" : undefined
                  }
                >
                  {module.price > 0
                    ? `Price: ₱${module.price.toLocaleString("en-PH")}`
                    : "Free"}
                </span>
              </div>

              {module.description && (
                <p className="mt-4 text-dacs-muted">{module.description}</p>
              )}
            </section>
          ))}

        {!loading && !loadError && modules.length === 0 && (
          <p className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-20 text-center text-dacs-muted">
            No seminar modules yet — click “+ Create Module” to add one.
          </p>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message="Delete Seminar?"
          detail={`Are you sure you want to delete "${moduleLabel(pendingDelete.moduleNumber, pendingDelete.title)}"? Modules with enrolled farmers are archived so their records are kept.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          destructive
          onConfirm={() => void deleteModule(pendingDelete)}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}
