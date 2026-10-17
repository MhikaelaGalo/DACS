"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";

export function CertificateNameEditor({
  certificateNumber, initialName, busy, error, onSave, onClose,
}: {
  certificateNumber: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const normalizedName = name.trim().replace(/\s+/gu, " ");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && normalizedName && normalizedName !== initialName) void onSave(normalizedName);
  }
  return (
    <Modal onClose={() => { if (!busy) onClose(); }} width="max-w-[520px]" closeButton={!busy}>
      <form onSubmit={submit} aria-busy={busy}>
        <h2 className="pr-8 text-2xl font-bold">Edit Certificate Name</h2>
        <p className="mt-2 text-sm text-dacs-muted">Certificate No. {certificateNumber}</p>
        <label htmlFor="certificate-recipient-name" className="mt-6 block text-sm font-semibold">Name on certificate</label>
        <input
          id="certificate-recipient-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
          autoFocus
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "certificate-name-error" : "certificate-name-help"}
          className="mt-2 w-full rounded-xl border border-dacs-dark/30 px-4 py-3 outline-none focus:border-blue-500 disabled:opacity-60"
        />
        <p id="certificate-name-help" className="mt-3 text-sm text-dacs-muted">The corrected name will appear on the farmer’s certificate and future downloads. The certificate number and validity dates stay the same.</p>
        {error && <p id="certificate-name-error" role="alert" className="mt-3 text-sm text-dacs-red">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-2xl border border-dacs-dark/40 px-6 py-3 font-semibold hover:bg-dacs-light/50 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || !normalizedName || normalizedName === initialName} className="rounded-2xl bg-dacs-dark px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save Changes"}</button>
        </div>
      </form>
    </Modal>
  );
}
