"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { errorMessage } from "@/lib/api";
import { recordOrderPayment, type RecordPaymentBody } from "@/lib/api/payments";
import { formatPeso } from "@/lib/format";
import type { OrderQueueRow } from "@/types/admin";

/*
 * Staff entry form for payments whose proof arrived by EMAIL (the
 * customer process — the website has no proof upload). Recording the
 * payment stores it as VERIFIED against the order, advances the order's
 * payment status, and excludes the order from the 14-day auto-cancel
 * sweep.
 */

const PAYMENT_TYPES: Array<{ value: RecordPaymentBody["paymentType"]; label: string }> = [
  { value: "FULL", label: "Full Payment" },
  { value: "DEPOSIT", label: "Deposit" },
  { value: "BALANCE", label: "Balance" },
  { value: "SHIPPING_FEE", label: "Shipping Fee" },
  { value: "PROCESSING_FEE", label: "Processing Fee" },
];

const underline =
  "border-b border-dacs-dark/40 bg-transparent py-1 outline-none focus:border-dacs-dark";

export function RecordPaymentModal({
  order,
  onRecorded,
  onCancel,
}: {
  order: OrderQueueRow;
  /** Called after a successful save so the queue refreshes. */
  onRecorded: (summary: string) => void;
  onCancel: () => void;
}) {
  const [paymentType, setPaymentType] =
    useState<RecordPaymentBody["paymentType"]>("FULL");
  const [amount, setAmount] = useState(String(order.totalAmount || ""));
  const [paymentDate, setPaymentDate] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (saving) return;
    const numericAmount = Number(amount);
    if (!amount.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError("Enter the amount that was paid.");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const result = await recordOrderPayment(order.id, {
        paymentType,
        amount: numericAmount,
        ...(paymentDate ? { paymentDate } : {}),
        ...(referenceNumber.trim()
          ? { referenceNumber: referenceNumber.trim() }
          : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onRecorded(
        result.orderStatusUpdated
          ? `Payment recorded — ${order.orderNumber} is now fully paid (Payment Verified).`
          : `Payment recorded for ${order.orderNumber} (verified total ${formatPeso(Number(result.verifiedTotal))}).`
      );
    } catch (error) {
      setFormError(
        errorMessage(error, "Unable to record this payment. Please try again.")
      );
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onCancel} width="max-w-[560px]">
      <h2 className="text-xl font-bold">Record Payment</h2>
      <p className="mt-1 text-sm text-dacs-muted">
        {order.orderNumber} · {order.customerName} · Total{" "}
        {formatPeso(order.totalAmount)}
      </p>
      <p className="mt-3 rounded-xl bg-dacs-light px-4 py-3 text-sm">
        For proof of payment received by email. The payment is saved as{" "}
        <b>Verified</b> under this order, and the order is excluded from the
        14-day automatic cancellation.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-dacs-muted">Payment Type</span>
          <select
            value={paymentType}
            onChange={(event) =>
              setPaymentType(event.target.value as RecordPaymentBody["paymentType"])
            }
            className={`w-full cursor-pointer ${underline}`}
          >
            {PAYMENT_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-dacs-muted">Amount Paid (₱)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`w-full ${underline}`}
          />
        </label>
        <label className="block">
          <span className="text-sm text-dacs-muted">Payment Date</span>
          <input
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            className={`w-full ${underline}`}
          />
        </label>
        <label className="block">
          <span className="text-sm text-dacs-muted">Reference Number</span>
          <input
            value={referenceNumber}
            onChange={(event) => setReferenceNumber(event.target.value)}
            placeholder="e.g. GCash ref. no."
            className={`w-full ${underline}`}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm text-dacs-muted">Notes</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. Proof received by email on 08/26"
            className={`w-full ${underline}`}
          />
        </label>
      </div>

      {formError && (
        <p role="alert" className="mt-4 text-sm font-semibold text-dacs-red">
          {formError}
        </p>
      )}

      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Recording…" : "Record Payment"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl border border-dacs-dark/40 px-8 py-3.5 font-semibold hover:bg-dacs-light/50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
