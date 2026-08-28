"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import type { SeminarView } from "@/services/seminar.service";

// Figma: seminar module card on the Seminars page (203:35 default state,
// 252:254 registered state with the "Registered" badge + "Take Now" button),
// rendered at 0.75 scale: card 407 -> 305 min-height, image 335 -> 251 wide,
// title 32 -> 24, meta 20 -> 15, body 24 -> 18, buttons 288x85 -> 216x64.
// The strict-sequence states reuse the same badge/button geometry: a green
// "Completed" badge once the exam is passed (Take Now then opens the
// certificate) and a gray "Locked" badge (lucide Lock — no Figma asset) with
// a disabled Take Now button while the previous module is incomplete.
//
// Paid modules extend the same card: the price ("Free" / "₱2,700") sits in
// the meta row, unpurchased paid modules get a working Add to Cart button
// into the ordinary DACS cart, a submitted checkout shows Payment Pending
// until staff verify the payment, and a verified purchase shows Purchased.
// Access (Take Now) additionally requires the previous module — purchase
// alone never bypasses the sequence.

interface SeminarCardProps {
  seminar: SeminarView;
  durationLabel: string;
  speaker: string;
  registered: boolean;
  /** Exam passed — shows the green "Completed" badge. */
  completed: boolean;
  /** Cannot be opened yet: previous module incomplete and/or paid module
   *  not yet owned (the backend enforces the same rule). */
  locked: boolean;
  /** e.g. "Complete Module 1 first." / "Purchase required — ₱2,700." */
  lockMessage?: string;
  detailsHref: string;
  /*
   * What a COMPLETED module offers next. The certificate belongs to the
   * whole required sequence, so only the module that ends it can offer
   * one — a finished Module 1 or 2 points at the next module instead.
   */
  completedAction?: "certificate" | "next-module" | null;
  /** Take Now / Go to Next Module / View Certificate — see completedAction. */
  onTake: () => void;
  /** Add to Cart for paid, not-yet-purchased modules (existing DACS cart). */
  onAddToCart: () => void;
  /** The module is already sitting in the cart. */
  inCart: boolean;
}

const actionButtonBase =
  "flex h-[64px] w-[216px] items-center justify-center rounded-[15px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]";

export function SeminarCard({
  seminar,
  durationLabel,
  speaker,
  registered,
  completed,
  locked,
  lockMessage,
  detailsHref,
  completedAction = null,
  onTake,
  onAddToCart,
  inCart,
}: SeminarCardProps) {
  const purchased = seminar.purchaseStatus === "OWNED";
  const paymentPending = seminar.purchaseStatus === "PENDING";
  const needsPurchase =
    !seminar.isFree && seminar.purchaseStatus === "NOT_PURCHASED" && !completed;
  // Take Now appears once the module is startable (registered/completed as
  // before) or openable outright (free/purchased with the sequence done —
  // enrollment then happens on click).
  const showTakeNow = registered || completed || seminar.accessible;

  return (
    // The card grows with its content: min-height (not fixed height) at lg and
    // the actions row stays in normal flow after the description, so the
    // button can never overlap the paragraph when the text wraps.
    <article className="relative flex flex-col overflow-clip rounded-[15px] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:min-h-[305px] lg:flex-row">
      {/* Cover artwork uploaded by DACS staff in the admin module editor
          (served from the backend, so a plain img — next/image only allows
          configured remote hosts). object-cover keeps any image size
          filling the slot without stretching; modules without a cover show
          a neutral placeholder instead. */}
      <div className="relative h-[220px] w-full shrink-0 lg:h-auto lg:w-[251px] lg:self-stretch">
        {seminar.imageUrl ? (
          <img
            src={seminar.imageUrl}
            alt={seminar.title}
            className="absolute inset-0 size-full rounded-t-[15px] object-cover lg:rounded-none lg:rounded-l-[15px]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center rounded-t-[15px] bg-[#f4f4f4] lg:rounded-none lg:rounded-l-[15px]">
            <img
              src="/images/logo.png"
              alt=""
              className="h-[96px] w-auto opacity-40"
            />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col px-[24px] pb-[32px] pt-[24px] lg:pb-[30px] lg:pl-[49px] lg:pr-[89px] lg:pt-[30px]">
        {/* Title + status badge share one row in normal flow (no absolute
            positioning, so the badge can never sit on top of the title): the
            title wraps in its own min-w-0 column with the badge pinned
            top-right beside it at lg, and the badge stacks below the title on
            narrow screens. In Figma the title text box extends past the
            1229px description column (up to 23px from the card's right edge);
            -mr lets the row use that extra width at lg. */}
        <div className="flex flex-col gap-[12px] lg:-mr-[66px] lg:flex-row lg:items-start lg:justify-between lg:gap-[24px]">
          <h2 className="min-w-0 flex-1 break-words text-[24px] font-semibold leading-normal text-black">
            {seminar.title}
          </h2>
          {completed ? (
            <div className="flex h-[30px] w-[134px] shrink-0 items-center justify-center rounded-[8px] bg-[#dbfae6] lg:mt-[6px]">
              <span className="text-[15px] leading-normal text-black">
                Completed
              </span>
            </div>
          ) : locked ? (
            <div className="flex h-[30px] w-[134px] shrink-0 items-center justify-center gap-[8px] rounded-[8px] bg-[#efeded] lg:mt-[6px]">
              <Lock aria-hidden className="size-[15px] shrink-0 text-[#6b6b6b]" />
              <span className="text-[15px] leading-normal text-[#6b6b6b]">
                Locked
              </span>
            </div>
          ) : registered ? (
            <div className="flex h-[30px] w-[134px] shrink-0 items-center justify-center rounded-[8px] bg-[#dbfae6] lg:mt-[6px]">
              <span className="text-[15px] leading-normal text-black">
                Registered
              </span>
            </div>
          ) : null}
        </div>
        <div className="mt-[14px] flex flex-wrap items-center gap-y-[8px]">
          <div className="flex w-[107px] items-center gap-[8px]">
            <img
              src="/figma/icon-clock.svg"
              alt=""
              className="size-[15px] shrink-0"
            />
            <p className="text-[15px] font-medium leading-normal text-[#7d7d7d]">
              {durationLabel}
            </p>
          </div>
          <div className="flex items-center gap-[8px]">
            <img
              src="/figma/icon-person.svg"
              alt=""
              className="h-[15px] w-[14px] shrink-0"
            />
            <p className="text-[15px] font-medium leading-normal text-[#7d7d7d]">
              {speaker}
            </p>
          </div>
          {/* Module price: "Free" for free modules, the peso price for paid
              ones, and a green Purchased tag once the payment is verified. */}
          {purchased ? (
            <span className="ml-auto rounded-[8px] bg-[#dbfae6] px-[12px] py-[3px] text-[15px] font-semibold leading-normal text-[#116530]">
              Purchased
            </span>
          ) : (
            <span
              className={`ml-auto text-[18px] font-semibold leading-normal ${
                seminar.isFree ? "text-[#116530]" : "text-[#c00]"
              }`}
            >
              {seminar.priceLabel}
            </span>
          )}
        </div>
        <p className="mt-[13px] text-justify text-[16px] leading-normal text-black lg:text-[18px]">
          {seminar.description}
        </p>
        {locked && lockMessage && (
          <p className="mt-[16px] text-[15px] font-semibold leading-normal text-[#c00]">
            {lockMessage}
          </p>
        )}
        {/* Finished SEMINAR (every required module) — announced only on
            the module that ends the sequence, never on Module 1 or 2. */}
        {completedAction === "certificate" && completed && (
          <p className="mt-[16px] text-[15px] font-semibold leading-normal text-[#116530]">
            Seminar Completed
          </p>
        )}
        {/* mt-auto pins the row to the card bottom when the text is short
            (matching the Figma 305px card exactly); pt guarantees a minimum
            gap below the description when the text wraps taller. */}
        <div className="mt-[32px] flex flex-wrap gap-[24px] lg:mt-auto lg:gap-[29px] lg:pt-[24px]">
          <Link
            href={detailsHref}
            className={`${actionButtonBase} bg-[#181818]`}
          >
            <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
              View Details
            </span>
          </Link>
          {needsPurchase && (
            <button
              type="button"
              onClick={onAddToCart}
              disabled={inCart}
              className={`${actionButtonBase} border border-[#181818] ${
                inCart ? "cursor-default opacity-60" : "cursor-pointer"
              }`}
            >
              <span className="text-[18px] font-bold leading-normal text-[#181818]">
                {inCart ? "In Cart" : "Add to Cart"}
              </span>
            </button>
          )}
          {paymentPending && !completed && (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className={`${actionButtonBase} cursor-not-allowed border border-[#181818] opacity-60`}
            >
              <span className="text-[18px] font-bold leading-normal text-[#7d7d7d]">
                Payment Pending
              </span>
            </button>
          )}
          {showTakeNow &&
            !needsPurchase &&
            !paymentPending &&
            (locked ? (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className={`${actionButtonBase} cursor-not-allowed border border-[#181818] opacity-50`}
              >
                <span className="text-[18px] font-bold leading-normal text-[#c00]">
                  Take Now
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onTake}
                className={`${actionButtonBase} cursor-pointer border border-[#181818]`}
              >
                <span className="text-[18px] font-bold leading-normal text-[#c00]">
                  {completed && completedAction === "certificate"
                    ? "View Certificate"
                    : completed && completedAction === "next-module"
                      ? "Go to Next Module"
                      : "Take Now"}
                </span>
              </button>
            ))}
        </div>
      </div>
    </article>
  );
}
