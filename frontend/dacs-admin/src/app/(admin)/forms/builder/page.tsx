"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightCircle,
  Calendar,
  CaseSensitive,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  GitBranch,
  GripVertical,
  Hash,
  ListChecks,
  PenLine,
  Pilcrow,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import {
  getForm,
  publishForm as publishFormRequest,
  toFormDefinition,
  toWireFields,
  updateForm,
} from "@/lib/api/forms";
import { appendAudit } from "@/lib/audit";
import { removeStorage, STORAGE_KEYS } from "@/lib/storage";
import type { FormBlock, FormDefinition, FormFieldType } from "@/types/admin";

/*
 * Drag-and-drop form builder. Field cards follow the approved redesign:
 * a header row (drag handle · type icon · type name · delete), a Field
 * label input, per-row editable options with remove/add/reorder, a
 * live preview that behaves like the real control, and a
 * Required/Optional toggle on every customer-input field.
 *
 * Data source: the DACS backend. Block edits stay local until Save
 * (PATCH /api/forms/:id, full field replacement) — Publish saves and
 * then flips the published state; customer submissions of published
 * order forms are turned into orders (client-confirmed flow).
 */

const PALETTE: Array<{
  type: FormFieldType;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}> = [
  { type: "title", label: "Title", icon: CaseSensitive },
  { type: "paragraph", label: "Paragraph", icon: Pilcrow },
  { type: "short-answer", label: "Short Answer", icon: PenLine },
  { type: "file-upload", label: "File Upload", icon: Upload },
  { type: "dropdown", label: "Dropdown", icon: ChevronDown },
  { type: "choice", label: "Choice", icon: ListChecks },
  { type: "number", label: "Number", icon: Hash },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare },
  { type: "date", label: "Date", icon: Calendar },
  { type: "time", label: "Time", icon: Clock },
  { type: "button", label: "Button", icon: ArrowRightCircle },
  { type: "conditional", label: "Conditional", icon: GitBranch },
];

const TYPE_META = Object.fromEntries(
  PALETTE.map(({ type, label, icon }) => [type, { label, icon }])
);

/* Field types customers fill in (they get the Required toggle). */
const INPUT_TYPES: FormFieldType[] = [
  "short-answer",
  "file-upload",
  "dropdown",
  "choice",
  "number",
  "checkbox",
  "date",
  "time",
  "conditional",
];

const DEFAULT_LABELS: Partial<Record<FormFieldType, string>> = {
  title: "New Title",
  paragraph: "New paragraph text...",
  button: "Submit Registration",
  dropdown: "Select an option",
  choice: "Select your preferred option",
  checkbox: "I have read and understood the instructions",
  time: "Preferred time",
  date: "Preferred date",
};

let blockCounter = 0;

function newBlock(type: FormFieldType): FormBlock {
  blockCounter += 1;
  return {
    id: `block-${Date.now()}-${blockCounter}`,
    type,
    label: DEFAULT_LABELS[type] ?? `New ${type.replace("-", " ")} field`,
    ...(type === "dropdown" || type === "choice"
      ? { options: ["Option 1", "Option 2"] }
      : {}),
    ...(type === "dropdown" ? { placeholder: "Select an option..." } : {}),
    ...(type === "time" ? { timeFormat: "12-hour" as const } : {}),
    ...(INPUT_TYPES.includes(type) ? { required: false } : {}),
  };
}

function BuilderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const formId = searchParams.get("form");

  const [form, setForm] = useState<FormDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const dragBlockId = useRef<string | null>(null);
  const dragPaletteType = useRef<FormFieldType | null>(null);
  /* Option-row drag state: which block + option index is being moved. */
  const dragOption = useRef<{ blockId: string; index: number } | null>(null);

  const load = useCallback(async () => {
    if (!formId) return;
    try {
      setForm(toFormDefinition(await getForm(formId)));
      setLoadError(null);
    } catch (error) {
      const message = errorMessage(error, "Unable to load this form.");
      /* 404 and bad-id both render the not-found state below. */
      setLoadError(message === "The requested record was not found." ? null : message);
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    /* The backend is the source of truth now — drop the old mock keys. */
    removeStorage(STORAGE_KEYS.formDraft);
    removeStorage(STORAGE_KEYS.deletedForms);
    if (!formId) {
      /* No form selected — the list page is the only entry point. */
      router.replace("/forms");
      return;
    }
    void load();
  }, [formId, load, router]);

  if (!formId) return null;

  if (loading) {
    return <p className="py-20 text-center text-dacs-muted">Loading form…</p>;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="text-dacs-muted">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="rounded-2xl bg-dacs-dark px-6 py-2.5 font-semibold text-white hover:opacity-90"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!form) {
    return <p className="py-20 text-center text-dacs-muted">Form not found.</p>;
  }

  function update(blocks: FormBlock[]) {
    setForm({ ...form!, blocks });
  }

  function addBlock(type: FormFieldType, beforeId?: string) {
    const block = newBlock(type);
    if (!beforeId) {
      update([...form!.blocks, block]);
      return;
    }
    const index = form!.blocks.findIndex((entry) => entry.id === beforeId);
    const next = [...form!.blocks];
    next.splice(index, 0, block);
    update(next);
  }

  function editBlock(id: string, changes: Partial<FormBlock>) {
    update(
      form!.blocks.map((block) =>
        block.id === id ? { ...block, ...changes } : block
      )
    );
  }

  function dropOnBlock(targetId: string) {
    if (dragPaletteType.current) {
      addBlock(dragPaletteType.current, targetId);
      dragPaletteType.current = null;
      return;
    }
    const sourceId = dragBlockId.current;
    dragBlockId.current = null;
    if (!sourceId || sourceId === targetId) return;

    const blocks = [...form!.blocks];
    const from = blocks.findIndex((entry) => entry.id === sourceId);
    const to = blocks.findIndex((entry) => entry.id === targetId);
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    update(blocks);
  }

  function reorderOption(blockId: string, from: number, to: number) {
    update(
      form!.blocks.map((block) => {
        if (block.id !== blockId || !block.options) return block;
        const options = [...block.options];
        const [moved] = options.splice(from, 1);
        options.splice(to, 0, moved);
        return { ...block, options };
      })
    );
  }

  /* Persist name + the full block set (server replaces all fields and
     issues fresh ids, so the state is refreshed from the response). */
  async function save(): Promise<FormDefinition | null> {
    const name = form!.name.trim();
    if (!name) {
      showToast("The form needs a name before it can be saved.", "error");
      return null;
    }
    const updated = toFormDefinition(
      await updateForm(form!.id, {
        name,
        fields: toWireFields(form!.blocks),
      })
    );
    setForm(updated);
    return updated;
  }

  async function saveForm() {
    if (saving || publishing) return;
    setSaving(true);
    try {
      const updated = await save();
      if (updated) {
        appendAudit("Forms", "FORM_UPDATED", `Saved form "${updated.name}".`);
        showToast("Form saved.");
      }
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to save this form. Please try again."),
        "error"
      );
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (saving || publishing) return;
    setPublishing(true);
    try {
      const saved = await save();
      if (!saved) return;
      if (!saved.isPublished) {
        setForm(toFormDefinition(await publishFormRequest(saved.id, true)));
      }
      appendAudit("Forms", "FORM_PUBLISHED", `Published form "${saved.name}".`);
      showToast("Form published.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to publish this form. Please try again."),
        "error"
      );
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (saving || publishing) return;
    setPublishing(true);
    try {
      setForm(toFormDefinition(await publishFormRequest(form!.id, false)));
      appendAudit("Forms", "FORM_UNPUBLISHED", `Unpublished form "${form!.name}".`);
      showToast("Form unpublished.");
    } catch (error) {
      showToast(
        errorMessage(error, "Unable to unpublish this form. Please try again."),
        "error"
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 lg:mb-8">
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[40px]">Forms</h1>
        <div className="flex flex-wrap items-center gap-3">
          {form.isPublished && (
            <span className="text-sm font-medium text-green-700">
              Published ✓
            </span>
          )}
          <button
            type="button"
            disabled={saving || publishing}
            onClick={() => void saveForm()}
            className="rounded-2xl border border-dacs-dark/40 px-8 py-3.5 font-semibold hover:bg-dacs-light/50 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {form.isPublished ? (
            <button
              type="button"
              disabled={saving || publishing}
              onClick={() => void unpublish()}
              className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {publishing ? "Working…" : "Unpublish"}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving || publishing}
              onClick={() => void publish()}
              className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        {/* Canvas */}
        <div
          className="rounded-dacs-card bg-white p-4 shadow-dacs-card sm:p-8"
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragPaletteType.current) {
              addBlock(dragPaletteType.current);
              dragPaletteType.current = null;
            }
          }}
        >
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="mb-6 w-full text-center text-2xl font-bold outline-none"
            aria-label="Form name"
          />

          <div className="flex flex-col gap-4">
            {form.blocks.map((block) => (
              <BlockCard
                key={block.id}
                block={block}
                onEdit={editBlock}
                onDelete={() =>
                  update(form.blocks.filter((entry) => entry.id !== block.id))
                }
                onDragStart={() => {
                  dragBlockId.current = block.id;
                }}
                onDropOn={() => dropOnBlock(block.id)}
                dragOption={dragOption}
                onReorderOption={reorderOption}
              />
            ))}

            {form.blocks.length === 0 && (
              <p className="rounded-xl border border-dashed border-dacs-dark/30 py-16 text-center text-dacs-muted">
                Drag fields here from the panel on the right.
              </p>
            )}
          </div>
        </div>

        {/* Palette */}
        <aside>
          <h2 className="text-2xl font-bold">Add Field</h2>
          <p className="mb-4 mt-1 text-sm text-dacs-muted">
            Drag a field into the form, or click to add it at the end. Then
            type its text directly inside the block.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {PALETTE.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                draggable
                onDragStart={() => {
                  dragPaletteType.current = type;
                }}
                onClick={() => addBlock(type)}
                className="flex cursor-grab items-center gap-2 rounded-xl border border-dacs-dark/30 px-4 py-2.5 text-sm font-medium hover:bg-dacs-light/60 active:cursor-grabbing"
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Field card shell: header row + type-specific body (the redesign).   */
/* ------------------------------------------------------------------ */

function BlockCard({
  block,
  onEdit,
  onDelete,
  onDragStart,
  onDropOn,
  dragOption,
  onReorderOption,
}: {
  block: FormBlock;
  onEdit: (id: string, changes: Partial<FormBlock>) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
  dragOption: React.MutableRefObject<{ blockId: string; index: number } | null>;
  onReorderOption: (blockId: string, from: number, to: number) => void;
}) {
  const meta = TYPE_META[block.type];
  const Icon = meta.icon;
  const isInput = INPUT_TYPES.includes(block.type);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.stopPropagation();
        onDropOn();
      }}
      className="group cursor-grab rounded-xl border border-dacs-dark/30 bg-white shadow-sm transition-colors hover:border-dacs-dark/60 active:cursor-grabbing"
    >
      {/* Header row: handle · icon · type name · delete */}
      <div className="flex items-center gap-2 border-b border-dacs-dark/15 px-3 py-2">
        <GripVertical size={16} className="text-dacs-muted" />
        <Icon size={15} className="text-dacs-dark" />
        <span className="text-xs font-bold uppercase tracking-wide text-dacs-dark">
          {meta.label}
        </span>
        <button
          type="button"
          aria-label={`Delete ${meta.label} field`}
          onClick={onDelete}
          className="ml-auto text-dacs-muted hover:text-dacs-red"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="px-4 py-3">
        <BlockBody
          block={block}
          onEdit={onEdit}
          dragOption={dragOption}
          onReorderOption={onReorderOption}
        />
      </div>

      {/* Required/Optional toggle for customer-input fields */}
      {isInput && (
        <div className="flex items-center justify-end gap-2 border-t border-dacs-dark/10 px-4 py-2">
          <span className="text-xs font-semibold text-dacs-muted">
            {block.required ? "Required" : "Optional"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!block.required}
            aria-label="Toggle required"
            onClick={() => onEdit(block.id, { required: !block.required })}
            className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
              block.required ? "bg-dacs-red" : "bg-dacs-dark/20"
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                block.required ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
      )}
    </div>
  );
}

/* Editable label input shared by field bodies. */
function LabelInput({
  block,
  onEdit,
  placeholder = "Field label...",
}: {
  block: FormBlock;
  onEdit: (id: string, changes: Partial<FormBlock>) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
        Field label
      </p>
      <input
        value={block.label}
        onChange={(event) => onEdit(block.id, { label: event.target.value })}
        placeholder={placeholder}
        className="w-full rounded-lg border border-dacs-dark/25 px-3 py-2 text-sm font-medium outline-none focus:border-dacs-dark"
      />
    </div>
  );
}

/* Options list with per-row edit/remove/reorder + add (+ paste-split). */
function OptionsEditor({
  block,
  onEdit,
  dragOption,
  onReorderOption,
  radio = false,
}: {
  block: FormBlock;
  onEdit: (id: string, changes: Partial<FormBlock>) => void;
  dragOption: React.MutableRefObject<{ blockId: string; index: number } | null>;
  onReorderOption: (blockId: string, from: number, to: number) => void;
  radio?: boolean;
}) {
  const options = block.options ?? [];

  function setOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    onEdit(block.id, { options: next });
  }

  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
        Options
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map((option, index) => (
          <div
            key={index}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              dragOption.current = { blockId: block.id, index };
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.stopPropagation();
              const source = dragOption.current;
              dragOption.current = null;
              if (source && source.blockId === block.id && source.index !== index) {
                onReorderOption(block.id, source.index, index);
              }
            }}
            className="flex items-center gap-2"
          >
            <GripVertical size={14} className="shrink-0 cursor-grab text-dacs-muted" />
            {radio ? (
              <CircleDot size={14} className="shrink-0 text-dacs-muted" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-dacs-dark/40" />
            )}
            <input
              value={option}
              onChange={(event) => setOption(index, event.target.value)}
              onPaste={(event) => {
                const text = event.clipboardData.getData("text");
                if (text.includes("\n")) {
                  /* Paste multiple options: one per line. */
                  event.preventDefault();
                  const pasted = text
                    .split("\n")
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  const next = [...options];
                  next.splice(index, 1, ...pasted);
                  onEdit(block.id, { options: next });
                }
              }}
              className="w-full rounded-md border border-dacs-dark/25 px-2.5 py-1.5 text-sm outline-none focus:border-dacs-dark"
            />
            <button
              type="button"
              aria-label="Remove option"
              onClick={() =>
                onEdit(block.id, {
                  options: options.filter((_, i) => i !== index),
                })
              }
              className="shrink-0 text-dacs-muted hover:text-dacs-red"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-4 text-sm">
        <button
          type="button"
          onClick={() =>
            onEdit(block.id, {
              options: [...options, `Option ${options.length + 1}`],
            })
          }
          className="flex items-center gap-1 font-medium text-dacs-red hover:underline"
        >
          <Plus size={13} />
          Add option
        </button>
        <button
          type="button"
          onClick={() => onEdit(block.id, { allowOther: !block.allowOther })}
          className={`flex items-center gap-1 font-medium hover:underline ${
            block.allowOther ? "text-dacs-dark" : "text-dacs-muted"
          }`}
        >
          {block.allowOther ? <X size={13} /> : <Plus size={13} />}
          {block.allowOther ? `Remove "Other"` : `Add "Other"`}
        </button>
        <span className="text-xs italic text-dacs-muted">
          Tip: paste multiple lines to add several options at once.
        </span>
      </div>
      {block.allowOther && (
        <div className="mt-1.5 flex items-center gap-2 pl-6 text-sm text-dacs-muted">
          {radio ? <CircleDot size={14} /> : <span className="h-3.5 w-3.5 rounded-sm border border-dacs-dark/40" />}
          <span className="italic">Other...</span>
        </div>
      )}
    </div>
  );
}

function BlockBody({
  block,
  onEdit,
  dragOption,
  onReorderOption,
}: {
  block: FormBlock;
  onEdit: (id: string, changes: Partial<FormBlock>) => void;
  dragOption: React.MutableRefObject<{ blockId: string; index: number } | null>;
  onReorderOption: (blockId: string, from: number, to: number) => void;
}) {
  switch (block.type) {
    case "title":
      return (
        <input
          value={block.label}
          onChange={(event) => onEdit(block.id, { label: event.target.value })}
          placeholder="Title text..."
          className="w-full border-b border-dacs-dark/20 pb-1 text-lg font-bold outline-none focus:border-dacs-dark"
        />
      );
    case "paragraph":
      return (
        <textarea
          value={block.label}
          onChange={(event) => onEdit(block.id, { label: event.target.value })}
          placeholder="Paragraph text..."
          rows={3}
          className="w-full resize-y text-sm outline-none"
        />
      );
    case "short-answer":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Question label..." />
          <div className="mt-2 border-b border-dacs-dark/40 pb-1 text-sm italic text-dacs-muted">
            Text here...
          </div>
        </div>
      );
    case "number":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Number label..." />
          <span className="mt-2 inline-block rounded-lg border border-dacs-dark/25 px-4 py-1 text-sm text-dacs-muted">
            0
          </span>
        </div>
      );
    case "checkbox":
      /* Single checkbox (acknowledgment/consent design). */
      return (
        <div>
          <LabelInput
            block={block}
            onEdit={onEdit}
            placeholder="I have read and understood..."
          />
          <label className="mt-3 flex items-center gap-3 rounded-lg border border-dacs-dark/25 px-3 py-2">
            <input type="checkbox" disabled className="h-4 w-4 accent-dacs-red" />
            <span className="text-sm">{block.label || "Checkbox label"}</span>
          </label>
        </div>
      );
    case "choice":
      /* Single-select radio options. */
      return (
        <div>
          <LabelInput
            block={block}
            onEdit={onEdit}
            placeholder="Select your preferred option"
          />
          <OptionsEditor
            block={block}
            onEdit={onEdit}
            dragOption={dragOption}
            onReorderOption={onReorderOption}
            radio
          />
        </div>
      );
    case "dropdown":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Select Layer Type" />
          <OptionsEditor
            block={block}
            onEdit={onEdit}
            dragOption={dragOption}
            onReorderOption={onReorderOption}
          />
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
              Placeholder
            </p>
            <input
              value={block.placeholder ?? ""}
              onChange={(event) =>
                onEdit(block.id, { placeholder: event.target.value })
              }
              placeholder="Select an option..."
              className="w-full rounded-lg border border-dacs-dark/25 px-3 py-2 text-sm outline-none focus:border-dacs-dark"
            />
          </div>
          {/* Live preview: a real dropdown, exactly what customers get. */}
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
              Preview
            </p>
            <select
              defaultValue=""
              className="w-full rounded-lg border border-dacs-dark/40 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                {block.placeholder || "Select an option..."}
              </option>
              {(block.options ?? []).map((option, index) => (
                <option key={index}>{option}</option>
              ))}
              {block.allowOther && <option>Other...</option>}
            </select>
          </div>
        </div>
      );
    case "date":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Preferred date" />
          <div className="mt-2 flex w-56 items-center gap-2 rounded-lg border border-dacs-dark/40 px-3 py-2 text-sm text-dacs-muted">
            <Calendar size={14} />
            MM/DD/YYYY
          </div>
        </div>
      );
    case "time":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Preferred pickup time" />
          <div className="mt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
              Preview
            </p>
            <div className="flex w-56 items-center justify-between rounded-lg border border-dacs-dark/40 px-3 py-2 text-sm text-dacs-muted">
              <span className="flex items-center gap-2">
                <Clock size={14} />
                HH : MM
              </span>
              <ChevronDown size={14} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-dacs-muted">
              Time format
            </span>
            <select
              value={block.timeFormat ?? "12-hour"}
              onChange={(event) =>
                onEdit(block.id, {
                  timeFormat: event.target.value as "12-hour" | "24-hour",
                })
              }
              className="rounded-lg border border-dacs-dark/40 px-2 py-1 text-sm"
            >
              <option value="12-hour">12-hour</option>
              <option value="24-hour">24-hour</option>
            </select>
          </div>
        </div>
      );
    case "file-upload":
      return (
        <div>
          <LabelInput block={block} onEdit={onEdit} placeholder="Upload label..." />
          <div className="mt-2 rounded-lg border border-dashed border-dacs-dark/40 py-3 text-center text-sm text-dacs-muted">
            File upload area
          </div>
        </div>
      );
    case "button":
      return (
        <div className="rounded-xl bg-dacs-dark py-3 text-center">
          <input
            value={block.label}
            onChange={(event) => onEdit(block.id, { label: event.target.value })}
            className="w-full bg-transparent text-center font-semibold text-white outline-none"
            aria-label="Button text"
          />
        </div>
      );
    case "conditional":
      return (
        <div className="flex items-center gap-3">
          <span className="rounded bg-dacs-light px-2 py-0.5 text-xs font-semibold uppercase text-dacs-muted">
            Conditional
          </span>
          <input
            value={block.label}
            onChange={(event) => onEdit(block.id, { label: event.target.value })}
            placeholder="Shown when the checkbox above is ticked..."
            className="w-full text-sm font-medium outline-none"
          />
        </div>
      );
  }
}

export default function FormBuilderPage() {
  return (
    <Suspense>
      <BuilderContent />
    </Suspense>
  );
}
