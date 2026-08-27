"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { ROUTES } from "@/constants/routes";
import { SeminarLockNotice } from "@/components/seminars/SeminarLockNotice";
import {
  fetchSeminarEligibility,
  type SeminarEligibility,
} from "@/services/eligibility.service";

// Figma: Forms Page 203:50 ("Documents" / "Order & Inquiry Forms").
// This page does not show the account sidebar, so it lives outside the
// (portal) route group.
// The PS and F1 cards lock until Seminar Modules 1-3 are completed: a Lock
// icon appears beside the title and "Open Form" becomes "Complete Seminars",
// opening the locked-order notice. The Submit a Ticket card is never locked.

// One shared card structure so every card's icon box, title line, description
// start, and Open Form action align identically across the grid:
// icon+title row (fixed 75px icon box, vertically centered) -> description
// area with a reserved minimum height -> action pinned to the card bottom.
function FormCard({
  icon,
  title,
  locked = false,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  locked?: boolean;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <article className="flex h-full w-full max-w-[395px] flex-col overflow-clip rounded-[15px] bg-white px-[24px] pb-[41px] pt-[31px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[38px]">
      <div className="flex min-h-[75px] items-center gap-[18px]">
        <div className="flex size-[75px] shrink-0 items-center justify-center">
          {icon}
        </div>
        <h2 className="min-w-0 flex-1 text-[24px] font-semibold leading-normal text-black">
          {title}
          {locked && (
            <Lock
              size={20}
              aria-label="Locked until seminars are completed"
              className="ml-[8px] inline-block align-[-2px]"
            />
          )}
        </h2>
      </div>
      <div className="mt-[28px] min-h-[110px] text-[18px] font-bold leading-normal">
        <p className="text-justify text-black">{description}</p>
      </div>
      <div className="mt-auto pt-[24px] text-[18px] font-bold leading-normal">
        {action}
      </div>
    </article>
  );
}

export default function FormsPage() {
  const [eligibility, setEligibility] = useState<SeminarEligibility | null>(
    null
  );
  const [lockOpen, setLockOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSeminarEligibility()
      .then((result) => {
        if (!cancelled) setEligibility(result);
      })
      .catch(() => {
        /* Unknown state keeps the cards locked — the safe direction. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The PS/F1 cards stay locked until eligibility is known (from the
  // DACS backend) — "Open Form" never flashes for a user who hasn't completed the
  // seminars.
  const locked = !eligibility || !eligibility.chickOrderingEligible;

  const lockedAction = (
    <button
      type="button"
      onClick={() => setLockOpen(true)}
      className="block cursor-pointer whitespace-pre text-left text-[#c00]"
    >
      {"Complete Seminars   >"}
    </button>
  );

  return (
    <div className="bg-white">
      <div className="mx-auto max-w-[1440px] px-[20px] pb-[60px] pt-[40px] lg:flex lg:min-h-[887px] lg:items-start lg:px-0 lg:pb-0 lg:pt-0">
        {/* Mobile: heading and card column share one centered 395px column
            (card text stays left-aligned); desktop keeps the Figma layout. */}
        <div className="mx-auto w-full max-w-[395px] lg:mx-0 lg:ml-[65px] lg:mt-[65px] lg:w-[325px] lg:max-w-none lg:shrink-0">
          <p className="text-[18px] font-semibold leading-normal text-[#c00]">
            Documents
          </p>
          <p className="mt-[7px] text-[26px] font-semibold leading-normal text-black lg:text-[30px]">
            Order &amp; Inquiry Forms
          </p>
        </div>

        <div className="mx-auto mt-[40px] grid w-full max-w-[395px] grid-cols-1 gap-x-[37px] gap-y-[41px] lg:mx-0 lg:ml-[108px] lg:mt-[82px] lg:max-w-[826px] lg:grid-cols-2">
          <FormCard
            icon={
              <div className="flex size-[75px] items-center justify-center overflow-clip rounded-[15px] bg-[#fff1bf]">
                <img
                  src="/figma/icon-form-chicken.png"
                  alt=""
                  className="size-[59px] object-cover"
                />
              </div>
            }
            title="Parent Stocks (PS) Order Form"
            locked={locked}
            description="Place your order for Parent Stocks (PS) chicks. Specify breeding purpose, delivery method, and quantities."
            action={
              locked ? (
                lockedAction
              ) : (
                <Link
                  href="/order/ps"
                  className="block cursor-pointer whitespace-pre text-left text-[#c00]"
                >
                  {"Open Form   >"}
                </Link>
              )
            }
          />

          <FormCard
            icon={
              <img
                src="/figma/icon-form-f1-egg.svg"
                alt=""
                className="size-[75px]"
              />
            }
            title="First Filial Generation (F1) Order Form"
            locked={locked}
            description="Order F1 chicks with preferred breeds, quantities, and delivery schedule."
            action={
              locked ? (
                lockedAction
              ) : (
                <Link
                  href="/order/f1"
                  className="block cursor-pointer whitespace-pre text-left text-[#c00]"
                >
                  {"Open Form   >"}
                </Link>
              )
            }
          />

          {/* Submit a Ticket — never locked by the seminar prerequisite */}
          <FormCard
            icon={
              <img
                src="/figma/icon-form-ticket.svg"
                alt=""
                className="size-[75px]"
              />
            }
            title="Submit a Ticket"
            description="Have any inquiries or questions? Submit a ticket and we'll get back to you as soon as possible."
            action={
              <div className="flex flex-col gap-[6px]">
                <Link
                  href="/account/forms/submit-ticket"
                  className="block cursor-pointer whitespace-pre text-left text-[#c00]"
                >
                  {"Open Form   >"}
                </Link>
                <Link
                  href={ROUTES.accountTickets}
                  className="block cursor-pointer whitespace-pre text-left text-[15px] text-[#7d7d7d] underline-offset-2 hover:underline"
                >
                  {"Track my tickets  >"}
                </Link>
              </div>
            }
          />
        </div>
      </div>
      <Footer />
      {eligibility && (
        <SeminarLockNotice
          open={lockOpen}
          onClose={() => setLockOpen(false)}
          eligibility={eligibility}
        />
      )}
    </div>
  );
}
