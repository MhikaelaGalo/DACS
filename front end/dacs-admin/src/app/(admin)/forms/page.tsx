"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  createForm,
  deleteForm as deleteFormRequest,
  listForms,
  toFormDefinition,
} from "@/lib/api/forms";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { FormDefinition } from "@/types/admin";

/*
 * Forms landing (Figma: PS + F1 order-form cards with View Form >).
 * Submissions of these forms become orders in the backend — the
 * builder edits what customers see.
 *
 * Data source: the DACS backend (GET/POST/DELETE /api/forms). Forms the
 * backend archived instead of deleting (they had submissions) are
 * hidden from this list; their history stays in the database.
 */
export default function FormsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FormDefinition | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listForms();
      setForms(data.map(toFormDefinition));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Unable to load forms. Please try again."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock keys. */
    removeStorage(STORAGE_KEYS.formDraft);
    removeStorage(STORAGE_KEYS.deletedForms);
    void refresh();
  }, [refresh]);

  async function createNewForm() {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createForm({ name: "Untitled Form", fields: [] });
      appendAudit("Forms", "FORM_CREATED", `Created form "${created.name}".`);
      router.push(`/forms/builder?form=${created.id}`);
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to create a form. Please try again."),
        "error"
      );
      setCreating(false);
    }
  }

  async function deleteForm(target: FormDefinition) {
    if (deleting) return;
    setDeleting(true);
    try {
      const outcome = await deleteFormRequest(target.id);
      appendAudit(
        "Forms",
        outcome.result === "DELETED" ? "FORM_DELETED" : "FORM_ARCHIVED",
        `Deleted form "${target.name}".`
      );
      showToast(
        outcome.result === "DELETED"
          ? "Form deleted successfully."
          : `Form archived — ${outcome.submissionCount} submission(s) are kept.`
      );
      await refresh();
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to delete this form. Please try again."),
        "error"
      );
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Forms</h1>
        <button
          type="button"
          disabled={creating}
          onClick={() => void createNewForm()}
          className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-7 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          <Plus size={18} />
          {creating ? "Creating…" : "Create Form"}
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {loading && (
          <p className="py-16 text-center text-sm text-dacs-muted">
            Loading forms…
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
          forms.map((form) => (
            <section
              key={form.id}
              className="rounded-dacs-card bg-white p-8 shadow-dacs-card"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <h2 className="min-w-0 break-words text-xl font-bold sm:text-2xl">{form.name}</h2>
                <Link
                  href={`/forms/builder?form=${form.id}`}
                  className="shrink-0 font-semibold text-dacs-red hover:underline"
                >
                  View Form &gt;
                </Link>
              </div>
              <p className="mt-3 text-dacs-muted">{form.description}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {form.isPublished ? (
                  <p className="text-sm font-semibold text-green-700">
                    Published ✓
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => setPendingDelete(form)}
                  className="flex items-center gap-2 rounded-2xl border border-dacs-red px-5 py-2.5 text-sm font-semibold text-dacs-red hover:bg-red-50"
                >
                  <Trash2 size={15} />
                  Delete Form
                </button>
              </div>
            </section>
          ))}

        {!loading && !loadError && forms.length === 0 && (
          <p className="rounded-dacs-card border border-dashed border-dacs-dark/30 py-20 text-center text-dacs-muted">
            No forms available.
          </p>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          message="Delete Form?"
          detail={`Are you sure you want to delete "${pendingDelete.name}"? Customers will no longer see this form. Forms with submissions are archived so their records are kept.`}
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          destructive
          onConfirm={() => void deleteForm(pendingDelete)}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}
