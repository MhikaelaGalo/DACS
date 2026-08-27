"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { formatPeso } from "@/lib/format";
import type { OrderQueueRow } from "@/types/admin";

/*
 * The ✎ Edit state (mockup "Edit Order" cards): quantity steppers per
 * product, editable prices and addresses, and — for F1/PS — the
 * deposit/balance payment schedule with dates and percentages.
 * Save Changes recomputes totals and persists; Cancel discards.
 */

function Stepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-dacs-dark/50 px-2.5 py-1">
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(value + 1)}
        className="text-dacs-dark hover:text-dacs-red"
      >
        <Plus size={13} />
      </button>
      <span className="min-w-6 text-center text-sm font-medium">{value}</span>
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="text-dacs-dark hover:text-dacs-red"
      >
        <Minus size={13} />
      </button>
    </span>
  );
}

const underline =
  "border-b border-dacs-dark/40 bg-transparent py-1 outline-none focus:border-dacs-dark";

export function EditOrderModal({
  order,
  onSave,
  onCancel,
}: {
  order: OrderQueueRow;
  onSave: (updated: OrderQueueRow) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<OrderQueueRow>(() =>
    structuredClone(order)
  );

  const typeLabel =
    order.orderType === "VETERINARY_PRODUCT"
      ? "Veterinary Products"
      : order.orderType === "F1"
        ? "F1"
        : "PS";

  function computeTotals(next: OrderQueueRow): OrderQueueRow {
    let itemTotal = 0;
    let quantity = 0;
    if (next.vetItems) {
      itemTotal = next.vetItems.reduce(
        (sum, item) => sum + item.quantity * item.price,
        0
      );
      quantity = next.vetItems.reduce((sum, item) => sum + item.quantity, 0);
    } else if (next.f1Items) {
      itemTotal = next.f1Items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );
      quantity = next.f1Items.reduce((sum, item) => sum + item.quantity, 0);
    } else if (next.psItems) {
      const rows = next.psItems.map((item) => ({
        ...item,
        amtF: item.qtyF * item.upF,
        amtM: item.qtyM * item.upM + item.qtyAddM * item.upAddM,
      }));
      next = { ...next, psItems: rows };
      itemTotal = rows.reduce((sum, item) => sum + item.amtF + item.amtM, 0);
      quantity = rows.reduce(
        (sum, item) => sum + item.qtyF + item.qtyM + item.qtyAddM,
        0
      );
    }
    return { ...next, quantity, totalAmount: itemTotal + next.feeTotal };
  }

  function submit() {
    onSave(computeTotals(draft));
  }

  return (
    <Modal onClose={onCancel} width="max-w-[720px]">
      <h2 className="text-2xl font-bold">Edit Order</h2>
      <p className="text-sm text-dacs-muted">{draft.orderNumber}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8">
        <label className="block">
          <span className="text-sm text-dacs-muted">Customer Name</span>
          <input
            value={draft.customerName}
            disabled
            title="Customer names belong to the customer profile and can't be edited from an order."
            className={`w-full text-dacs-muted ${underline}`}
          />
        </label>
        <div>
          <p className="text-sm text-dacs-muted">Order Type</p>
          <p className="py-1 font-medium">{typeLabel}</p>
        </div>
      </div>

      {/* Product table with steppers */}
      <div className="mt-6 rounded-xl border border-dacs-light">
        <div className="grid grid-cols-[1fr_106px_86px] rounded-t-xl bg-dacs-light px-3 py-2.5 text-sm font-semibold text-dacs-muted sm:grid-cols-[1fr_150px_170px] sm:px-5">
          <span>Product Name</span>
          <span className="text-center">Quantity</span>
          <span className="text-right">Price</span>
        </div>

        {draft.vetItems?.map((item, index) => (
          <div
            key={item.product}
            className="grid grid-cols-[1fr_106px_86px] items-center border-t border-dacs-light px-3 py-2.5 text-sm sm:grid-cols-[1fr_150px_170px] sm:px-5 sm:text-base"
          >
            <span>{item.product}</span>
            <span className="text-center">
              <Stepper
                value={item.quantity}
                onChange={(quantity) => {
                  const vetItems = [...draft.vetItems!];
                  vetItems[index] = { ...item, quantity };
                  setDraft({ ...draft, vetItems });
                }}
              />
            </span>
            <span className="text-right">
              <input
                type="number"
                value={item.price}
                onChange={(event) => {
                  const vetItems = [...draft.vetItems!];
                  vetItems[index] = { ...item, price: Number(event.target.value) };
                  setDraft({ ...draft, vetItems });
                }}
                className={`w-full max-w-28 text-right ${underline}`}
              />
            </span>
          </div>
        ))}

        {draft.f1Items?.map((item, index) => (
          <div
            key={item.product}
            className="grid grid-cols-[1fr_106px_86px] items-center border-t border-dacs-light px-3 py-2.5 text-sm sm:grid-cols-[1fr_150px_170px] sm:px-5 sm:text-base"
          >
            <span>{item.product}</span>
            <span className="text-center">
              <Stepper
                value={item.quantity}
                onChange={(quantity) => {
                  const f1Items = [...draft.f1Items!];
                  f1Items[index] = { ...item, quantity };
                  setDraft({ ...draft, f1Items });
                }}
              />
            </span>
            <span className="text-right">
              {item.quantity > 0 ? (
                <input
                  type="number"
                  value={item.unitPrice}
                  min={item.priceMin}
                  max={item.priceMax}
                  onChange={(event) => {
                    const f1Items = [...draft.f1Items!];
                    f1Items[index] = {
                      ...item,
                      unitPrice: Number(event.target.value),
                    };
                    setDraft({ ...draft, f1Items });
                  }}
                  className={`w-full max-w-28 text-right ${underline}`}
                />
              ) : (
                <span className="text-dacs-muted">
                  {formatPeso(item.priceMin)} - {formatPeso(item.priceMax)}
                </span>
              )}
            </span>
          </div>
        ))}

        {draft.psItems?.map((item, index) => (
          <div
            key={item.product}
            className="grid grid-cols-2 items-center gap-2 border-t border-dacs-light px-3 py-2.5 text-sm sm:grid-cols-[1fr_repeat(3,150px)] sm:px-5"
          >
            <span>{item.product}</span>
            <span className="text-center">
              <span className="mr-2 text-xs text-dacs-muted">F</span>
              <Stepper
                value={item.qtyF}
                onChange={(qtyF) => {
                  const psItems = [...draft.psItems!];
                  psItems[index] = { ...item, qtyF };
                  setDraft({ ...draft, psItems });
                }}
              />
            </span>
            <span className="text-center">
              <span className="mr-2 text-xs text-dacs-muted">M</span>
              <Stepper
                value={item.qtyM}
                onChange={(qtyM) => {
                  const psItems = [...draft.psItems!];
                  psItems[index] = { ...item, qtyM };
                  setDraft({ ...draft, psItems });
                }}
              />
            </span>
            <span className="text-center">
              <span className="mr-2 text-xs text-dacs-muted">Add M</span>
              <Stepper
                value={item.qtyAddM}
                onChange={(qtyAddM) => {
                  const psItems = [...draft.psItems!];
                  psItems[index] = { ...item, qtyAddM };
                  setDraft({ ...draft, psItems });
                }}
              />
            </span>
          </div>
        ))}
      </div>

      {/* Addresses */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8">
        {draft.orderType === "VETERINARY_PRODUCT" ? (
          <>
            <label className="block">
              <span className="text-sm text-dacs-muted">Door-to-door Address</span>
              <input
                value={draft.deliveryAddress ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, deliveryAddress: event.target.value })
                }
                className={`w-full ${underline}`}
              />
            </label>
            <label className="block">
              <span className="text-sm text-dacs-muted">LBC Branch Pick-up</span>
              <input
                value={draft.pickupBranch ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, pickupBranch: event.target.value })
                }
                className={`w-full ${underline}`}
              />
            </label>
          </>
        ) : (
          <label className="col-span-2 block">
            <span className="text-sm text-dacs-muted">Address</span>
            <input
              value={draft.deliveryAddress ?? draft.airportLocation ?? ""}
              onChange={(event) =>
                setDraft(
                  draft.fulfillmentMethod === "AIRPORT"
                    ? { ...draft, airportLocation: event.target.value }
                    : { ...draft, deliveryAddress: event.target.value }
                )
              }
              className={`w-full ${underline}`}
            />
          </label>
        )}
      </div>

      {/* Payment schedule (F1/PS orders per the mockup) */}
      {draft.orderType !== "VETERINARY_PRODUCT" && (
        <div className="mt-6">
          <p className="text-sm font-bold">Payment Due Date</p>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-8">
            <div>
              <p className="text-sm font-semibold text-dacs-muted">Deposit</p>
              <div className="flex items-center gap-4">
                <input
                  type="date"
                  value={draft.depositDueDate ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, depositDueDate: event.target.value })
                  }
                  className={`flex-1 ${underline}`}
                />
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={draft.depositPercent ?? 0}
                    onChange={(event) => {
                      const depositPercent = Number(event.target.value);
                      setDraft({
                        ...draft,
                        depositPercent,
                        balancePercent: 100 - depositPercent,
                      });
                    }}
                    className={`w-16 text-center ${underline}`}
                  />
                  <span className="text-sm text-dacs-muted">%</span>
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-dacs-muted">Balance</p>
              <div className="flex items-center gap-4">
                <input
                  type="date"
                  value={draft.balanceDueDate ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, balanceDueDate: event.target.value })
                  }
                  className={`flex-1 ${underline}`}
                />
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    value={draft.balancePercent ?? 0}
                    readOnly
                    className={`w-16 text-center ${underline} text-dacs-muted`}
                  />
                  <span className="text-sm text-dacs-muted">%</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={submit}
          className="rounded-2xl bg-dacs-dark px-8 py-3.5 font-semibold text-white hover:opacity-90"
        >
          Save Changes
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
