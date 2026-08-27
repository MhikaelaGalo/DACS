"use client";

import { X } from "lucide-react";

/* Shared overlay modal: click-outside closes, white rounded card. */
export function Modal({
  onClose,
  children,
  width = "max-w-[860px]",
  closeButton = true,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /* Max-width class; the card is always w-full below that cap. */
  width?: string;
  closeButton?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3 sm:p-8"
      onClick={onClose}
    >
      <div
        className={`relative max-h-full w-full ${width} overflow-y-auto rounded-dacs-card bg-white p-5 sm:p-8`}
        onClick={(event) => event.stopPropagation()}
      >
        {closeButton && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 text-dacs-dark hover:text-dacs-red sm:right-6 sm:top-6"
          >
            <X size={24} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/*
 * Mockup confirmation popup: "Are you sure...?" + Yes, Proceed / Cancel.
 * Destructive flows pass `destructive` (red confirm), a custom
 * `confirmLabel` (e.g. "Delete") and an optional `detail` line such as
 * "This action cannot be undone.".
 */
export function ConfirmDialog({
  message,
  detail,
  confirmLabel = "Yes, Proceed",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  detail?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[460px] rounded-dacs-card bg-white p-6 text-center shadow-dacs-card sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-lg font-bold">{message}</p>
        {detail && <p className="mt-2 text-sm text-dacs-muted">{detail}</p>}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-2xl px-7 py-3 font-semibold text-white hover:opacity-90 ${
              destructive ? "bg-dacs-red" : "bg-dacs-dark"
            }`}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-dacs-dark/40 px-7 py-3 font-semibold hover:bg-dacs-light/50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* Farm-logo style image viewer: white card with an X (mockup). */
export function ImageModal({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} width="max-w-[560px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="mx-auto max-h-[420px] py-6" />
    </Modal>
  );
}
