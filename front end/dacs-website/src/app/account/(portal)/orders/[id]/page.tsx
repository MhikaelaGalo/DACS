"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { OrderDetailView } from "@/components/orders/OrderDetailView";
import { ROUTES } from "@/constants/routes";
import { ApiError, errorMessage } from "@/lib/api";
import {
  getMyOrder,
  listMyPayments,
  type ApiOrder,
  type ApiPayment,
} from "@/lib/api/orders";

// Order detail (replaces the Figma mock receipt): the real backend order
// with items, totals, staff payment schedule, payments, and — while the
// order awaits payment — the email-only payment instructions with the
// order's own 14-day deadline.
export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [payments, setPayments] = useState<ApiPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [orderResult, allPayments] = await Promise.all([
        getMyOrder(id),
        listMyPayments().catch(() => [] as ApiPayment[]),
      ]);
      setOrder(orderResult);
      setPayments(allPayments.filter((payment) => payment.orderId === id));
      setLoadError(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoadError("This order was not found on your account.");
      } else {
        setLoadError(
          errorMessage(error, "Unable to load this order right now.")
        );
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="lg:ml-[101px] lg:mr-[42px] lg:min-h-[733px] lg:pb-[60px] lg:pt-[45px]">
      <div className="flex max-w-[977px] items-center justify-between gap-[12px]">
        <h1 className="text-[24px] font-semibold leading-normal text-black">
          Order Details
        </h1>
        <Link
          href={ROUTES.accountOrders}
          className="whitespace-pre text-[15px] leading-normal text-[#c00]"
        >
          {"< Back to Order History"}
        </Link>
      </div>

      <div className="mt-[20px]">
        {loading && (
          <p className="text-[15px] leading-normal text-[#7d7d7d]">
            Loading order...
          </p>
        )}
        {!loading && loadError && (
          <p className="text-[15px] leading-normal text-[#c00]">{loadError}</p>
        )}
        {!loading && !loadError && order && (
          <OrderDetailView order={order} payments={payments} />
        )}
      </div>
    </div>
  );
}
