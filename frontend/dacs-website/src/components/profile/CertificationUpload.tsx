"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import type { CertificationDocumentMeta } from "@/services/user.service";

// Functional "Upload certification documents" dropzone for the Personal
// Information edit page (Figma 256:6370): click-to-browse + drag-and-drop
// over the existing dashed box, PDF/PNG/JPG validation, 100MB limit,
// dedupe, previews for images, and per-file remove.
// TODO: Upload certification document to DACS backend storage

const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const MAX_BYTES = 100 * 1024 * 1024;

export interface WorkingCertificationDoc extends CertificationDocumentMeta {
  /** Present only for files chosen this session (not yet "uploaded"). */
  previewUrl?: string;
  isPending: boolean;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Manages the working list (saved metadata + newly selected files). */
export function useCertificationDocuments(saved: CertificationDocumentMeta[]) {
  const [docs, setDocs] = useState<WorkingCertificationDoc[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const revokeAll = useCallback((list: WorkingCertificationDoc[]) => {
    list.forEach((d) => {
      if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
    });
  }, []);

  /** Loads the saved records (entering edit mode / after save / on cancel). */
  const reset = useCallback(
    (records: CertificationDocumentMeta[]) => {
      setDocs((current) => {
        revokeAll(current);
        return records.map((r) => ({ ...r, isPending: false }));
      });
      setErrors([]);
      setDirty(false);
    },
    [revokeAll]
  );

  useEffect(() => {
    reset(saved);
    // Revoke any remaining object URLs when the page unmounts.
    return () => {
      setDocs((current) => {
        current.forEach((d) => {
          if (d.previewUrl) URL.revokeObjectURL(d.previewUrl);
        });
        return current;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: File[]) {
    // Validation runs outside the state updater so the collected error
    // messages are available synchronously for setErrors.
    const nextErrors: string[] = [];
    const additions: WorkingCertificationDoc[] = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        nextErrors.push("Only PDF, PNG, JPG, and JPEG files are allowed.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        nextErrors.push("Each file must be 100MB or smaller.");
        continue;
      }
      const duplicate =
        docs.some((d) => d.name === file.name && d.size === file.size) ||
        additions.some((d) => d.name === file.name && d.size === file.size);
      if (duplicate) {
        nextErrors.push(`"${file.name}" is already in the list.`);
        continue;
      }
      additions.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
        isPending: true,
      });
    }
    if (additions.length > 0) {
      setDocs((current) => [...current, ...additions]);
      setDirty(true);
    }
    setErrors([...new Set(nextErrors)]);
  }

  function remove(id: string) {
    setDocs((current) => {
      const target = current.find((d) => d.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((d) => d.id !== id);
    });
    setDirty(true);
  }

  /** Metadata to persist on Save Changes. */
  function toMetadata(): CertificationDocumentMeta[] {
    return docs.map(({ id, name, type, size, uploadedAt }) => ({
      id,
      name,
      type,
      size,
      uploadedAt,
    }));
  }

  return { docs, errors, dirty, addFiles, remove, reset, toMetadata };
}

export function CertificationUpload({
  docs,
  errors,
  onAddFiles,
  onRemove,
}: {
  docs: WorkingCertificationDoc[];
  errors: string[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  return (
    <div className="max-w-[849px]">
      <input
        ref={fileInputRef}
        id="certification-upload"
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        multiple
        className="sr-only"
        onChange={(event) => {
          onAddFiles(Array.from(event.target.files ?? []));
          // Allow re-selecting the same file after a remove.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label="Upload certification documents"
        aria-describedby="certification-upload-hint certification-upload-errors"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          onAddFiles(Array.from(event.dataTransfer.files ?? []));
        }}
        className={`mt-[20px] flex h-[154px] w-full cursor-pointer flex-col items-center justify-center gap-[7px] rounded-[11px] border border-dashed px-[18px] text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#181818] ${
          dragActive
            ? "border-[#c00] bg-[rgba(204,0,0,0.05)]"
            : "border-[#181818] bg-transparent"
        }`}
      >
        <span className="pointer-events-none text-[18px] font-semibold leading-normal text-[#7d7d7d]">
          Upload certification documents
        </span>
        <span
          id="certification-upload-hint"
          className="pointer-events-none text-[15px] leading-normal text-[#7d7d7d]"
        >
          PDF, PNG, JPG, up to 100MB
        </span>
      </button>
      <div id="certification-upload-errors" role="alert">
        {errors.map((message) => (
          <p
            key={message}
            className="mt-[8px] text-[14px] leading-normal text-[#c00]"
          >
            {message}
          </p>
        ))}
      </div>
      {docs.length > 0 && (
        <div className="mt-[16px] flex flex-col gap-[10px]">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-[14px] rounded-[11px] bg-white px-[16px] py-[10px] shadow-[0px_0px_8px_0px_rgba(0,0,0,0.15)]"
            >
              {doc.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={doc.previewUrl}
                  alt=""
                  className="size-[40px] shrink-0 rounded-[6px] border border-[#e5e5e5] object-cover"
                />
              ) : (
                <FileText
                  size={28}
                  aria-hidden
                  className="shrink-0 text-[#7d7d7d]"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold leading-normal text-black">
                  {doc.name}
                </p>
                <p className="text-[13px] leading-normal text-[#7d7d7d]">
                  {doc.type === "application/pdf" ? "PDF" : "Image"} ·{" "}
                  {formatFileSize(doc.size)}
                  {doc.isPending ? "" : " · Saved"}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${doc.name}`}
                onClick={() => onRemove(doc.id)}
                className="flex size-[32px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[#c00] transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-[#c00]"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
