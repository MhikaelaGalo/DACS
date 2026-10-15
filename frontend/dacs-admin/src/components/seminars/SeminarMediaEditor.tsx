"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Modal";
import { errorMessage } from "@/lib/api";

/** File selection stays local until Save; the existing file remains usable. */
export function SeminarMediaEditor({
  kind,
  label,
  currentUrl,
  onSave,
  onRemove,
}: {
  kind: "image" | "video";
  label: string;
  currentUrl?: string | null;
  onSave: (file: File, durationSeconds: number | null) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function clearSelection() {
    setFile(null);
    setPreviewUrl(null);
    setDuration(null);
    setPreviewReady(false);
    setError(null);
  }

  function selectFile(next: File) {
    const types = kind === "image"
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["video/mp4", "video/webm"];
    const maxMB = kind === "image" ? 5 : 100;
    if (!types.includes(next.type)) {
      setError(kind === "image" ? "Choose a JPG, PNG, or WebP image." : "Choose an MP4 or WebM video.");
      return;
    }
    if (next.size === 0 || next.size > maxMB * 1024 * 1024) {
      setError(`Choose a non-empty file no larger than ${maxMB} MB.`);
      return;
    }
    setPreviewUrl(null);
    setDuration(null);
    setPreviewReady(false);
    setError(null);
    setFile(next);
  }

  async function save() {
    if (!file || !previewReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(file, duration);
      clearSelection();
    } catch (failure) {
      setError(errorMessage(failure, "Unable to save this file. Your previous file is still in place."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove();
      clearSelection();
      setConfirmingRemove(false);
    } catch (failure) {
      setConfirmingRemove(false);
      setError(errorMessage(failure, "Unable to remove this file. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const source = previewUrl ?? currentUrl;
  return (
    <div className="space-y-3">
      {kind === "image" ? (
        source ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={source} src={source} alt={file ? `New ${label} preview` : label}
            className="aspect-[4/3] w-full rounded-lg border border-dacs-light object-cover"
            onLoad={() => { if (file && previewUrl) setPreviewReady(true); }}
            onError={() => { if (file) { setPreviewReady(false); setError("This image could not be previewed. Choose another file."); } }} />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center gap-2 rounded-lg border border-dashed border-dacs-dark/30 text-dacs-muted">
            <ImageIcon size={24} /> No cover image yet
          </div>
        )
      ) : source ? (
        <video key={source} src={source} controls preload={file ? "metadata" : "none"}
          aria-label={file ? `New ${label} preview` : label}
          className="max-h-[300px] w-full rounded-lg bg-black"
          onLoadedMetadata={(event) => {
            if (!file) return;
            const seconds = Math.round(event.currentTarget.duration);
            if (Number.isFinite(seconds) && seconds > 0) { setDuration(seconds); setPreviewReady(true); }
            else { setError("This video's duration could not be read. Choose another file."); }
          }}
          onError={() => { if (file) { setPreviewReady(false); setError("This video could not be previewed. Choose another file."); } }} />
      ) : null}
      {file && <p className="break-words text-sm text-dacs-muted">Preview: {file.name}. Changes are saved only when you select Save changes.</p>}
      {error && <p role="alert" className="text-sm text-dacs-red">{error}</p>}
      <input ref={input} type="file" className="hidden"
        accept={kind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm"}
        onChange={(event) => { const next = event.target.files?.[0]; if (next) selectFile(next); event.target.value = ""; }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          aria-label={`${currentUrl ? "Replace" : "Upload"} ${label}`}
          className="flex items-center gap-2 rounded-2xl bg-dacs-dark px-4 py-2 font-semibold text-white disabled:opacity-60">
          <Upload size={16} /> {currentUrl ? "Replace" : "Upload Image"}
        </button>
        {file && <>
          <button type="button" disabled={busy || !previewReady} onClick={() => void save()}
            className="rounded-2xl bg-dacs-dark px-4 py-2 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" disabled={busy} onClick={clearSelection}
            className="rounded-2xl border border-dacs-dark/30 px-4 py-2">Cancel</button>
        </>}
        {currentUrl && <button type="button" disabled={busy || Boolean(file)} onClick={() => setConfirmingRemove(true)}
          aria-label={`Remove ${label}`}
          className="flex items-center gap-2 rounded-2xl border border-dacs-red/40 px-4 py-2 font-semibold text-dacs-red disabled:opacity-60"><Trash2 size={16} /> Remove</button>}
      </div>
      {confirmingRemove && <ConfirmDialog message={`Remove ${label}?`}
        detail={kind === "video" ? "Farmers will lose access to this video. Existing certificates and completion records will be preserved." : "The seminar card will show its placeholder until a new cover is uploaded."}
        confirmLabel="Remove" destructive busy={busy} onConfirm={() => void remove()} onCancel={() => { if (!busy) setConfirmingRemove(false); }} />}
    </div>
  );
}
