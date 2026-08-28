"use client";

/*
 * Order detail for the account portal: the real backend order (items with
 * snapshot prices, server totals, staff payment schedule, status history)
 * plus the payment records on the order. Proof of payment is EMAIL ONLY —
 * customers send it to the DACS email address and staff record it — so
 * while the order still awaits payment this view shows the payment
 * instructions and the order's own 14-day deadline instead of the old
 * in-app upload form.
 */
import {
  PAYMENT_PROOF_EMAIL,
  PaymentDeadlineNotice,
} from "@/components/orders/PaymentDeadlineNotice";
import { OrderStatusBadge } from "@/components/profile/OrderStatusBadge";
import {
  fulfillmentLabel,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TYPE_LABELS,
  type ApiOrder,
  type ApiPayment,
} from "@/lib/api/orders";
import { formatDate } from "@/lib/utils/format";

function peso(value: string | number): string {
  return `₱${Number(value).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const cardClass =
  "rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px] lg:py-[28px]";
const sectionTitleClass = "text-[18px] font-bold leading-normal text-black";
const metaLabelClass = "text-[12px] font-bold leading-normal text-[#7d7d7d]";
const metaValueClass = "mt-[4px] text-[15px] leading-normal text-black";

export function OrderDetailView({
  order,
  payments,
}: {
  order: ApiOrder;
  payments: ApiPayment[];
}) {
  // Payment instructions matter while the order can still take (more)
  // payments — before it is rejected, cancelled or fully verified.
  const awaitingPayment =
    order.status === "PENDING" ||
    order.status === "APPROVED" ||
    order.status === "PAYMENT_SUBMITTED";

  return (
    <div className="flex max-w-[977px] flex-col gap-[24px]">
      {/* Order header */}
      <div className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-[12px]">
          <div>
            <p className="text-[24px] font-semibold leading-normal text-black">
              {order.orderNumber}
            </p>
            <p className="mt-[4px] text-[15px] leading-normal text-[#7d7d7d]">
              {ORDER_TYPE_LABELS[order.orderType]} ·{" "}
              {formatDate(order.createdAt)}
            </p>
          </div>
          <OrderStatusBadge status={ORDER_STATUS_LABELS[order.status]} />
        </div>
        <div className="mt-[20px] grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <div>
            <p className={metaLabelClass}>Fulfillment</p>
            <p className={metaValueClass}>{fulfillmentLabel(order)}</p>
          </div>
          {order.dateNeeded && (
            <div>
              <p className={metaLabelClass}>Date Needed</p>
              <p className={metaValueClass}>{formatDate(order.dateNeeded)}</p>
            </div>
          )}
          {order.receiverName && (
            <div>
              <p className={metaLabelClass}>Receiver</p>
              <p className={metaValueClass}>
                {order.receiverName}
                {order.receiverContact ? ` · ${order.receiverContact}` : ""}
              </p>
            </div>
          )}
          {order.hatchDate && (
            <div>
              <p className={metaLabelClass}>Hatch Date</p>
              <p className={metaValueClass}>{formatDate(order.hatchDate)}</p>
            </div>
          )}
          {order.instructions && (
            <div className="sm:col-span-2">
              <p className={metaLabelClass}>Notes</p>
              <p className={`${metaValueClass} whitespace-pre-line`}>
                {order.instructions}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Items + totals */}
      <div className={cardClass}>
        <p className={sectionTitleClass}>Items</p>
        <div className="mt-[12px] overflow-x-auto">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="text-[12px] font-bold text-[#7d7d7d]">
                <th className="pb-[8px] pr-[12px] font-bold">Item</th>
                <th className="pb-[8px] pr-[12px] font-bold">Qty</th>
                <th className="pb-[8px] pr-[12px] font-bold">Unit Price</th>
                <th className="pb-[8px] text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="text-[15px] text-black">
                  <td className="py-[6px] pr-[12px]">
                    {item.productNameSnapshot}
                  </td>
                  <td className="py-[6px] pr-[12px]">{item.quantity}</td>
                  <td className="py-[6px] pr-[12px]">
                    {peso(item.unitPriceSnapshot)}
                  </td>
                  <td className="py-[6px] text-right">{peso(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-[16px] flex flex-col items-end gap-[4px] text-[15px] text-black">
          <p>Subtotal: {peso(order.subtotal)}</p>
          <p>
            Fees:{" "}
            {Number(order.feeTotal) > 0
              ? peso(order.feeTotal)
              : "To be confirmed by DACS staff"}
          </p>
          <p className="text-[18px] font-bold">
            Total: {peso(order.totalAmount)}
          </p>
        </div>
        {(order.depositPercent !== null ||
          order.depositDueDate ||
          order.balanceDueDate) && (
          <div className="mt-[16px] rounded-[10px] bg-[#f4f4f4] px-[16px] py-[12px] text-[14px] leading-normal text-black">
            <p className="font-bold">Payment Schedule</p>
            {order.depositPercent !== null && (
              <p className="mt-[4px]">
                Deposit: {order.depositPercent}%
                {order.depositDueDate
                  ? ` — due ${formatDate(order.depositDueDate)}`
                  : ""}
              </p>
            )}
            {order.depositPercent !== null && (
              <p>
                Balance: {100 - order.depositPercent}%
                {order.balanceDueDate
                  ? ` — due ${formatDate(order.balanceDueDate)}`
                  : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Payments on this order */}
      <div className={cardClass}>
        <p className={sectionTitleClass}>Payments</p>
        {payments.length === 0 ? (
          <p className="mt-[8px] text-[15px] leading-normal text-[#7d7d7d]">
            {awaitingPayment
              ? "No payment has been recorded for this order yet."
              : "No payments were recorded for this order."}
          </p>
        ) : (
          <div className="mt-[12px] flex flex-col gap-[12px]">
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="rounded-[10px] border border-[#e2e2e2] px-[16px] py-[12px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <p className="text-[15px] font-semibold text-black">
                    {PAYMENT_TYPE_LABELS[payment.paymentType]} ·{" "}
                    {peso(payment.amount)}
                  </p>
                  <OrderStatusBadge
                    status={PAYMENT_STATUS_LABELS[payment.status]}
                  />
                </div>
                <p className="mt-[4px] text-[13px] leading-normal text-[#7d7d7d]">
                  {payment.paymentDate
                    ? `Paid ${formatDate(payment.paymentDate)}`
                    : `Recorded ${formatDate(payment.createdAt)}`}
                  {payment.referenceNumber
                    ? ` · Ref. ${payment.referenceNumber}`
                    : ""}
                </p>
                {payment.status === "REJECTED" && payment.rejectionReason && (
                  <p className="mt-[4px] text-[13px] leading-normal text-[#a11212]">
                    Rejected: {payment.rejectionReason}
                  </p>
                )}
                {payment.proofStorageUrl && (
                  <a
                    href={payment.proofStorageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-[6px] inline-block text-[13px] leading-normal text-[#c00] underline-offset-2 hover:underline"
                  >
                    View submitted proof
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {awaitingPayment && (
          <div className="mt-[20px]">
            <p className="text-[15px] font-bold leading-normal text-black">
              How to Pay
            </p>
            <p className="mt-[4px] text-[14px] leading-normal text-[#555]">
              Pay via GCash or bank transfer per your quotation, then email a
              photo or screenshot of your receipt to{" "}
              <a
                href={`mailto:${PAYMENT_PROOF_EMAIL}`}
                className="font-semibold text-[#c00] underline underline-offset-2"
              >
                {PAYMENT_PROOF_EMAIL}
              </a>
              . DACS staff will record and verify your payment — the status
              updates here once it is processed.
            </p>
            <PaymentDeadlineNotice
              className="mt-[12px]"
              deadline={order.paymentDeadlineAt}
            />
          </div>
        )}
      </div>

      {/* Status history */}
      {order.statusHistory.length > 0 && (
        <div className={cardClass}>
          <p className={sectionTitleClass}>Status History</p>
          <div className="mt-[12px] flex flex-col gap-[8px]">
            {order.statusHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-[8px] text-[14px] leading-normal"
              >
                <p className="text-black">
                  {ORDER_STATUS_LABELS[entry.toStatus]}
                  {entry.notes ? (
                    <span className="text-[#7d7d7d]"> — {entry.notes}</span>
                  ) : null}
                </p>
                <p className="text-[#7d7d7d]">{formatDate(entry.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
