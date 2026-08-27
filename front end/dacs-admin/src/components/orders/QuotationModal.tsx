"use client";

import { HistoricalImportBadge } from "@/components/historical/HistoricalRecords";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatLongDate, formatPeso, formatSlashDate } from "@/lib/format";
import type { ApiOrderDetail } from "@/lib/api/orders";
import type { OrderQueueRow } from "@/types/admin";

/*
 * The 👁 View state (mockups OCQ-1..4): the order quotation exactly as
 * designed per order type — VET (product/qty/unit/price + DALG fee),
 * F1 (unit-price ranges + transporter charges + deposit/balance dues),
 * PS "IBPS" (sets / female / male / additional-male component columns).
 */

function HeaderField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm text-dacs-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

function PaymentDue({ order }: { order: OrderQueueRow }) {
  if (!order.depositDueDate || !order.balanceDueDate) return null;
  return (
    <span>
      {formatSlashDate(order.depositDueDate)} –{" "}
      <b>{order.depositPercent}% deposit</b>
      <span className="mx-2 text-dacs-muted">|</span>
      {formatSlashDate(order.balanceDueDate)} – <b>{order.balancePercent}% balance</b>
    </span>
  );
}

const FULFILLMENT_LABELS: Record<string, string> = {
  PICKUP: "Farm Pick-Up",
  LBC_BRANCH: "LBC Branch",
  AIRPORT: "Airport Cargo",
  DELIVERY: "Door-to-door Delivery",
};

export function QuotationModal({
  order,
  detail,
  onClose,
}: {
  order: OrderQueueRow;
  /* Full backend order (payments, provenance); null while loading. */
  detail?: ApiOrderDetail | null;
  onClose: () => void;
}) {
  const banner =
    order.orderType === "VETERINARY_PRODUCT"
      ? "Order Quotation – 2026 Veterinary Health Products"
      : order.orderType === "F1"
        ? "Order Quotation – F1 Order Quotation"
        : order.orderType === "SEMINAR"
          ? "Order Quotation – Seminar Module Access"
          : "Order Quotation – IBPS Order Quotation";

  const isHistorical = order.source === "HISTORICAL_IMPORT";
  const payments = detail?.payments ?? null;
  const location =
    order.airportLocation ?? order.pickupBranch ?? order.deliveryAddress;

  return (
    <Modal onClose={onClose} width="max-w-[900px]">
      {isHistorical && (
        <div className="mb-4 mr-8 flex flex-wrap items-center gap-3 rounded-2xl bg-purple-50 px-5 py-3.5">
          <HistoricalImportBadge />
          <span className="text-sm text-purple-900">
            Imported from a legacy spreadsheet — this order did not go through
            the live DACS ordering workflow.
          </span>
        </div>
      )}

      {/* Quotation header card */}
      <div className="mr-8 grid grid-cols-1 gap-x-10 gap-y-5 rounded-2xl border border-dacs-light p-5 sm:grid-cols-2 sm:p-6">
        <HeaderField
          label={order.orderType === "SEMINAR" ? "Purchased By" : "Delivery Details"}
          value={order.receiverName ?? "N/A"}
        />
        <HeaderField label="Order Number" value={order.orderNumber} />
        <HeaderField
          label="Contact / FB Name"
          value={`${order.receiverContact ?? "N/A"} / ${order.receiverFacebook ?? "N/A"}`}
        />
        {order.orderType === "VETERINARY_PRODUCT" && (
          <HeaderField
            label="Pick-up at LBC Branch"
            value={order.pickupBranch ?? "N/A"}
          />
        )}
        {order.orderType === "F1" && (
          <HeaderField label="Farm Name" value={order.farmName ?? "N/A"} />
        )}
        {order.orderType === "PARENT_STOCK" && (
          <HeaderField
            label="OQ Date"
            value={order.oqDate ? formatLongDate(order.oqDate) : "N/A"}
          />
        )}

        {order.orderType === "VETERINARY_PRODUCT" && (
          <div className="sm:col-span-2">
            <HeaderField
              label="Door-to-door Address"
              value={order.deliveryAddress ?? "N/A"}
            />
          </div>
        )}
        {order.orderType === "SEMINAR" && (
          <div className="sm:col-span-2">
            <HeaderField
              label="Fulfillment"
              value="Online seminar access — the module unlocks for the customer once the payment is verified"
            />
          </div>
        )}
        {order.orderType === "F1" && (
          <>
            <HeaderField label="Location" value={order.deliveryAddress ?? "N/A"} />
            <HeaderField label="Payment Due Date" value={<PaymentDue order={order} />} />
          </>
        )}
        {order.orderType === "PARENT_STOCK" && (
          <>
            <HeaderField label="Payment Due Date" value={<PaymentDue order={order} />} />
            <HeaderField
              label="Location"
              value={order.airportLocation ?? order.deliveryAddress ?? "N/A"}
            />
          </>
        )}
      </div>

      <div className="mt-6 rounded-md bg-[#f5c8c8] py-3 text-center font-bold">
        {banner}
      </div>

      {/* Line items per order type */}
      {order.vetItems && (
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[15px]">
          <thead>
            <tr className="bg-dacs-light text-dacs-muted">
              <th className="rounded-l-md px-4 py-2.5 text-left font-semibold">
                Product Name
              </th>
              <th className="px-4 py-2.5 font-semibold">Quantity</th>
              <th className="px-4 py-2.5 font-semibold">Unit</th>
              <th className="px-4 py-2.5 font-semibold">Price</th>
              <th className="rounded-r-md px-4 py-2.5 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {order.vetItems.map((item) => (
              <tr key={item.product} className="border-b border-dacs-light">
                <td className="px-4 py-3 text-left">{item.product}</td>
                <td className="px-4 py-3 text-center">{item.quantity}</td>
                <td className="px-4 py-3 text-center">{item.unit}</td>
                <td className="px-4 py-3 text-center">
                  {formatPeso(item.price)}.00
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPeso(item.quantity * item.price)}.00
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {order.f1Items && (
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-[15px]">
          <thead>
            <tr className="bg-dacs-light text-dacs-muted">
              <th className="rounded-l-md px-4 py-2.5 text-left font-semibold">
                Product Name
              </th>
              <th className="px-4 py-2.5 font-semibold">Quantity</th>
              <th className="px-4 py-2.5 font-semibold">Unit Price</th>
              <th className="rounded-r-md px-4 py-2.5 text-right font-semibold">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {order.f1Items.map((item) => (
              <tr key={item.product} className="border-b border-dacs-light">
                <td className="px-4 py-3 text-left">{item.product}</td>
                <td className="px-4 py-3 text-center">{item.quantity}</td>
                <td className="px-4 py-3 text-center">
                  {formatPeso(item.priceMin)} - {formatPeso(item.priceMax)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatPeso(item.quantity * item.unitPrice)}.00
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Seminar-module access lines: fixed quantity 1, checkout-time
          price snapshots. Verifying the payment (Record Payment) is what
          unlocks the module for the customer. */}
      {order.seminarItems && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[15px]">
            <thead>
              <tr className="bg-dacs-light text-dacs-muted">
                <th className="rounded-l-md px-4 py-2.5 text-left font-semibold">
                  Seminar Module
                </th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Quantity</th>
                <th className="rounded-r-md px-4 py-2.5 text-right font-semibold">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {order.seminarItems.map((item) => (
                <tr key={item.module} className="border-b border-dacs-light">
                  <td className="px-4 py-3 text-left">{item.module}</td>
                  <td className="px-4 py-3 text-center">Seminar</td>
                  <td className="px-4 py-3 text-center">{item.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {formatPeso(item.price)}.00
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {order.psItems && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="bg-dacs-light text-dacs-muted">
                <th className="rounded-l-md px-3 py-2.5 text-left font-semibold">
                  Product Name
                </th>
                <th className="px-3 py-2.5 font-semibold">Sets</th>
                <th className="px-3 py-2.5 font-semibold">Qty F</th>
                <th className="px-3 py-2.5 font-semibold">UP (F)</th>
                <th className="px-3 py-2.5 font-semibold">Qty M</th>
                <th className="px-3 py-2.5 font-semibold">UP (M)</th>
                <th className="px-3 py-2.5 font-semibold">Qty Add M</th>
                <th className="px-3 py-2.5 font-semibold">UP Add M</th>
                <th className="px-3 py-2.5 font-semibold">Amt F</th>
                <th className="px-3 py-2.5 font-semibold">Amt M</th>
                <th className="rounded-r-md px-3 py-2.5 text-right font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {order.psItems.map((item) => (
                <tr key={item.product} className="border-b border-dacs-light">
                  <td className="px-3 py-3 text-left">{item.product}</td>
                  <td className="px-3 py-3 text-center">{item.sets}</td>
                  <td className="px-3 py-3 text-center">{item.qtyF}</td>
                  <td className="px-3 py-3 text-center">{formatPeso(item.upF)}</td>
                  <td className="px-3 py-3 text-center">{item.qtyM}</td>
                  <td className="px-3 py-3 text-center">{formatPeso(item.upM)}</td>
                  <td className="px-3 py-3 text-center">{item.qtyAddM}</td>
                  <td className="px-3 py-3 text-center">
                    {formatPeso(item.upAddM)}
                  </td>
                  <td className="px-3 py-3 text-center">{formatPeso(item.amtF)}</td>
                  <td className="px-3 py-3 text-center">{formatPeso(item.amtM)}</td>
                  <td className="px-3 py-3 text-right">
                    {formatPeso(item.amtF + item.amtM)}.00
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Fees + total */}
      <div className="mt-2 flex flex-col items-end gap-1 pr-1">
        <div className="flex w-[360px] items-center justify-between text-sm">
          <span className="font-semibold text-dacs-muted">
            {order.orderType === "VETERINARY_PRODUCT"
              ? "DALG Processing Fee"
              : order.orderType === "SEMINAR"
                ? "Processing Fee"
                : "Transporter/Shipper Charges"}
          </span>
          <span>{formatPeso(order.feeTotal)}</span>
        </div>
        <div className="flex w-[360px] items-center justify-between">
          <span className="font-bold text-dacs-red">TOTAL AMOUNT DUE</span>
          <span className="text-lg font-bold text-dacs-red">
            {formatPeso(order.totalAmount)}.00
          </span>
        </div>
      </div>

      {/* Order state + logistics */}
      <div className="mt-6 rounded-2xl border border-dacs-light p-5">
        <h3 className="mb-3 text-lg font-bold">Order Details</h3>
        <div className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2">
          <HeaderField label="Status" value={<StatusBadge status={order.status} />} />
          <HeaderField
            label="Order Date"
            value={order.oqDate ? formatSlashDate(order.oqDate) : "N/A"}
          />
          <HeaderField
            label="Date Needed"
            value={order.dateNeeded ? formatSlashDate(order.dateNeeded) : "N/A"}
          />
          <HeaderField
            label="Fulfillment"
            value={
              order.fulfillmentMethod
                ? `${FULFILLMENT_LABELS[order.fulfillmentMethod] ?? order.fulfillmentMethod}${location ? ` — ${location}` : ""}`
                : "N/A"
            }
          />
          {order.hatchDate && (
            <HeaderField label="Hatch Date" value={formatSlashDate(order.hatchDate)} />
          )}
          {detail?.releasedAt && (
            <HeaderField
              label="Release Date"
              value={formatSlashDate(detail.releasedAt.slice(0, 10))}
            />
          )}
          {detail?.paymentDeadlineAt && (
            <HeaderField
              label="Payment Deadline"
              value={`${formatSlashDate(detail.paymentDeadlineAt.slice(0, 10))} — auto-cancels if unpaid`}
            />
          )}
          <div className="sm:col-span-2">
            <HeaderField label="Instructions" value={order.instructions ?? "N/A"} />
          </div>
        </div>
      </div>

      {/* Payment history (order detail; legacy summaries carry no proof) */}
      <div className="mt-6 rounded-2xl border border-dacs-light p-5">
        <h3 className="mb-3 text-lg font-bold">Payment History</h3>
        {!detail && (
          <p className="py-2 text-sm text-dacs-muted">Loading payment history…</p>
        )}
        {detail && (payments?.length ?? 0) === 0 && (
          <p className="py-2 text-sm text-dacs-muted">
            No payment records for this order.
          </p>
        )}
        {detail && (payments?.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[15px]">
              <thead>
                <tr className="bg-dacs-light text-dacs-muted">
                  <th className="rounded-l-md px-4 py-2.5 text-left font-semibold">
                    Type
                  </th>
                  <th className="px-4 py-2.5 font-semibold">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Payment Date</th>
                  <th className="px-4 py-2.5 font-semibold">Reference</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="rounded-r-md px-4 py-2.5 text-right font-semibold">
                    Proof
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments!.map((payment) => (
                  <tr key={payment.id} className="border-b border-dacs-light">
                    <td className="px-4 py-3 text-left">{payment.paymentType}</td>
                    <td className="px-4 py-3 text-center">
                      {formatPeso(Number(payment.amount))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {payment.paymentDate
                        ? formatSlashDate(payment.paymentDate.slice(0, 10))
                        : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {payment.referenceNumber ?? "N/A"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {payment.proofStorageUrl ? (
                        <a
                          href={payment.proofStorageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-dacs-red underline hover:opacity-80"
                        >
                          View proof
                        </a>
                      ) : (
                        <span className="text-dacs-muted">
                          {payment.source === "HISTORICAL_IMPORT"
                            ? "No proof file — historical import"
                            : "No proof file"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
