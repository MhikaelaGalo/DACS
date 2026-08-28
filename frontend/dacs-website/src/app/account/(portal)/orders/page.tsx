"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderStatusBadge } from "@/components/profile/OrderStatusBadge";
import { formatPeso } from "@/components/profile/peso";
import { ROUTES } from "@/constants/routes";
import { ApiError, errorMessage } from "@/lib/api";
import {
  listMyOrders,
  ORDER_STATUS_LABELS,
  type ApiOrder,
} from "@/lib/api/orders";
import { formatDate } from "@/lib/utils/format";

// Figma: Order History 255:4190 — cards now list the account's REAL
// orders from GET /api/orders/me (newest first, server-created numbers).
function itemSummary(order: ApiOrder): string {
  const first = order.items[0];
  if (!first) return "";
  const summary = `${first.productNameSnapshot} x${first.quantity}`;
  return order.items.length > 1
    ? `${summary} (+${order.items.length - 1} more)`
    : summary;
}

const ORDERS_PER_PAGE = 5;

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    listMyOrders()
      .then((list) => {
        if (cancelled) return;
        setOrders(list);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        // A 404 means no customer profile yet — an empty history, not an
        // error worth alarming the farmer about.
        if (error instanceof ApiError && error.status === 404) {
          setOrders([]);
        } else {
          setLoadError(
            errorMessage(error, "Unable to load your orders right now.")
          );
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(orders.length / ORDERS_PER_PAGE));
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedOrders = orders.slice(
    (currentPage - 1) * ORDERS_PER_PAGE,
    currentPage * ORDERS_PER_PAGE
  );

  /** Change page and bring the top of the list back into view. */
  function goToPage(page: number) {
    setCurrentPage(page);
    window.scrollTo(0, 0);
  }

  return (
    // lg:pb keeps the pagination row (or last card) clear of the footer when
    // a full page of orders grows past the Figma min-height.
    <div className="lg:ml-[101px] lg:mr-[42px] lg:min-h-[733px] lg:pb-[60px] lg:pt-[45px]">
      <h1 className="text-[24px] font-semibold leading-normal text-black">
        Order History
      </h1>

      <div className="mt-[20px] flex max-w-[977px] flex-col gap-[32px]">
        {loading && (
          <div className="rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px] lg:py-[32px]">
            <p className="text-[15px] leading-normal text-[#7d7d7d]">
              Loading your orders...
            </p>
          </div>
        )}
        {!loading && loadError && (
          <div className="rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px] lg:py-[32px]">
            <p className="text-[15px] leading-normal text-[#c00]">{loadError}</p>
          </div>
        )}
        {!loading && !loadError && orders.length === 0 && (
          <div className="rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px] lg:py-[32px]">
            <p className="text-[18px] font-semibold leading-normal text-black">
              No orders yet
            </p>
            <p className="mt-[8px] text-[15px] leading-normal text-[#7d7d7d]">
              Your completed and pending orders will appear here.
            </p>
          </div>
        )}
        {paginatedOrders.map((order) => (
          <div
            key={order.id}
            className="relative min-h-[173px] rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:p-0"
          >
            <p className="text-[18px] leading-normal text-black lg:absolute lg:left-[38px] lg:top-[24px]">
              {order.orderNumber}
            </p>
            <p className="mt-[8px] text-[15px] leading-normal text-[#7d7d7d] lg:absolute lg:left-[38px] lg:top-[54px] lg:mt-0">
              {itemSummary(order)}
            </p>
            <p className="mt-[8px] text-[12px] leading-normal text-[#7d7d7d] lg:absolute lg:left-[38px] lg:top-[80px] lg:mt-0">
              {formatDate(order.createdAt)}
            </p>
            <Link
              href={`${ROUTES.accountOrders}/${order.id}`}
              className="mt-[24px] inline-block whitespace-pre text-[12px] leading-normal text-[#c00] lg:absolute lg:left-[38px] lg:top-[136px] lg:mt-0"
            >
              {"Click to view order details  >"}
            </Link>
            <div className="mt-[16px] flex w-fit lg:absolute lg:right-[26px] lg:top-[21px] lg:mt-0">
              <OrderStatusBadge status={ORDER_STATUS_LABELS[order.status]} />
            </div>
            <p className="mt-[8px] text-[18px] leading-normal text-black lg:absolute lg:right-[26px] lg:top-[70px] lg:mt-0 lg:text-right">
              {formatPeso(Number(order.totalAmount))}
            </p>
          </div>
        ))}
      </div>

      {/* Pagination — newest first, 5 per page; hidden with a single page
          (and with the empty state). */}
      {totalPages > 1 && (
        <div className="mt-[32px] flex max-w-[977px] items-center justify-between gap-[16px] pb-[8px] lg:mt-[40px]">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => goToPage(Math.max(1, currentPage - 1))}
            className="flex h-[44px] w-[120px] cursor-pointer items-center justify-center rounded-[15px] border border-[#181818] bg-white text-[15px] font-bold leading-normal text-black shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>
          <span className="text-[15px] leading-normal text-[#7d7d7d]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => goToPage(Math.min(totalPages, currentPage + 1))}
            className="flex h-[44px] w-[120px] cursor-pointer items-center justify-center rounded-[15px] bg-[#181818] text-[15px] font-bold leading-normal text-[#f4f4f4] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
