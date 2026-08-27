"use client";

/*
 * My Tickets: the account's inquiry tickets from GET /api/inquiries/me.
 * Rows expand to show the message and the status history (responses are
 * sent through the official DACS email; the ticket tracks the status).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Footer } from "@/components/layout/Footer";
import { OrderStatusBadge } from "@/components/profile/OrderStatusBadge";
import { ROUTES } from "@/constants/routes";
import { ApiError, errorMessage } from "@/lib/api";
import {
  getMyInquiry,
  listMyInquiries,
  TICKET_STATUS_LABELS,
  type ApiInquiryTicket,
} from "@/lib/api/inquiries";
import { formatDate } from "@/lib/utils/format";

export default function MyTicketsPage() {
  const [tickets, setTickets] = useState<ApiInquiryTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ApiInquiryTicket>>({});

  useEffect(() => {
    let cancelled = false;
    listMyInquiries()
      .then((list) => {
        if (cancelled) return;
        setTickets(list);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setTickets([]);
        } else {
          setLoadError(
            errorMessage(error, "Unable to load your tickets right now.")
          );
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(ticketId: string) {
    const next = openId === ticketId ? null : ticketId;
    setOpenId(next);
    if (next && !details[next]) {
      getMyInquiry(next)
        .then((detail) =>
          setDetails((current) => ({ ...current, [next]: detail }))
        )
        .catch(() => {
          /* The summary row still shows; history just stays hidden. */
        });
    }
  }

  return (
    <div className="bg-[#f4f4f4]">
      <div className="mx-auto min-h-[60vh] w-full max-w-[1440px] px-[20px] pb-[60px] pt-[40px] lg:px-[42px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <h1 className="text-[24px] font-semibold leading-normal text-black">
            My Tickets
          </h1>
          <Link
            href="/account/forms/submit-ticket"
            className="whitespace-pre text-[15px] leading-normal text-[#c00]"
          >
            {"Submit a Ticket  >"}
          </Link>
        </div>

        <div className="mt-[24px] flex max-w-[977px] flex-col gap-[20px]">
          {loading && (
            <p className="text-[15px] leading-normal text-[#7d7d7d]">
              Loading your tickets...
            </p>
          )}
          {!loading && loadError && (
            <p className="text-[15px] leading-normal text-[#c00]">{loadError}</p>
          )}
          {!loading && !loadError && tickets.length === 0 && (
            <div className="rounded-[15px] bg-white p-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px]">
              <p className="text-[18px] font-semibold leading-normal text-black">
                No tickets yet
              </p>
              <p className="mt-[8px] text-[15px] leading-normal text-[#7d7d7d]">
                Questions and follow-ups you submit through the ticket form
                will appear here with their status.
              </p>
            </div>
          )}
          {tickets.map((ticket) => {
            const open = openId === ticket.id;
            const detail = details[ticket.id];
            return (
              <div
                key={ticket.id}
                className="rounded-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
              >
                <button
                  type="button"
                  onClick={() => toggle(ticket.id)}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-[12px] p-[24px] text-left lg:px-[38px]"
                >
                  <div className="min-w-0">
                    <p className="text-[18px] font-semibold leading-normal text-black">
                      {ticket.ticketNumber}
                    </p>
                    <p className="mt-[4px] truncate text-[15px] leading-normal text-[#7d7d7d]">
                      {ticket.subject}
                    </p>
                    <p className="mt-[4px] text-[12px] leading-normal text-[#7d7d7d]">
                      Submitted {formatDate(ticket.createdAt)}
                      {ticket.relatedOrder
                        ? ` · Order ${ticket.relatedOrder.orderNumber}`
                        : ""}
                    </p>
                  </div>
                  <OrderStatusBadge
                    status={TICKET_STATUS_LABELS[ticket.status]}
                  />
                </button>
                {open && (
                  <div className="border-t border-[#e2e2e2] p-[24px] lg:px-[38px]">
                    <p className="whitespace-pre-line text-[15px] leading-normal text-black">
                      {ticket.message}
                    </p>
                    {ticket.status === "RESPONDED" ||
                    ticket.status === "CLOSED" ? (
                      <p className="mt-[12px] text-[14px] leading-normal text-[#188038]">
                        DACS responded through the official email
                        {detail?.emailRespondedAt
                          ? ` on ${formatDate(detail.emailRespondedAt)}`
                          : ""}
                        . Check the inbox you provided.
                      </p>
                    ) : (
                      <p className="mt-[12px] text-[14px] leading-normal text-[#7d7d7d]">
                        Responses are sent through the official DACS email.
                      </p>
                    )}
                    {detail?.statusHistory &&
                      detail.statusHistory.length > 0 && (
                        <div className="mt-[16px] flex flex-col gap-[6px]">
                          <p className="text-[13px] font-bold leading-normal text-[#7d7d7d]">
                            Status History
                          </p>
                          {detail.statusHistory.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex flex-wrap items-baseline justify-between gap-[8px] text-[13px] leading-normal"
                            >
                              <p className="text-black">
                                {TICKET_STATUS_LABELS[entry.toStatus]}
                                {entry.notes ? (
                                  <span className="text-[#7d7d7d]">
                                    {" "}
                                    — {entry.notes}
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[#7d7d7d]">
                                {formatDate(entry.createdAt)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Footer />
    </div>
  );
}
