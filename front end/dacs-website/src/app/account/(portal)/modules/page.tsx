"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";
import { formatDate } from "@/lib/utils/format";
import {
  canAccessView,
  certificateAvailableOn,
  fetchSeminarState,
  setActiveSeminarId,
  type SeminarSequenceId,
} from "@/services/seminar.service";

// Figma: Modules Taken 255:4285 — same card design, but the rows derive from
// the signed-in account's live seminar progress: Recent = the earliest
// incomplete unlocked module (Continue resumes its video flow) plus the
// still-locked modules (lucide Lock, no link); Previous = completed modules
// with their completion dates and View Certificate links. An account that
// has not entered the seminar flow (no enrollment, no progress) sees an
// empty state instead — never another account's module history.

interface RecentRow {
  id: SeminarSequenceId;
  title: string;
  locked: boolean;
  /** Enrollment exists — Continue resumes the flow instead of registering. */
  started: boolean;
  /** False for exam-only modules; Continue opens the exam directly. */
  hasVideos: boolean;
  /** Shown when the module is in progress. */
  startedOn?: string;
}

interface PreviousRow {
  id: SeminarSequenceId;
  title: string;
  completedOn?: string;
  /** The account's APPROVED Certificate of Attendance (only after all
   *  three modules are complete and DACS staff approve the request);
   *  otherwise the live completion page opens instead. */
  certificateId?: string;
}

export default function ModulesTakenPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [recentRows, setRecentRows] = useState<RecentRow[]>([]);
  const [previousRows, setPreviousRows] = useState<PreviousRow[]>([]);
  // False until the client-side storage read finishes, so the empty state
  // never flashes for accounts that do have module history.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // One progress call carries the module views AND the account's
        // seminar-completion record (including the earned certificate's
        // id) — no second certificates request is needed here.
        const { views, completion } = await fetchSeminarState();
        if (cancelled) return;

        // Modules Taken lists only this account's own training: nothing
        // renders until the farmer enrolled in a module.
        const enteredFlow = views.some((view) => view.started);
        if (!enteredFlow) {
          setLoaded(true);
          return;
        }

        /* The single Certificate of Attendance for the whole required
           sequence — never a per-module document, so it is attached only
           to the module that ends that sequence. */
        const earnedCertificate =
          completion.certificate?.status === "APPROVED" &&
          completion.certificate.certificateNumber
            ? completion.certificate
            : null;
        const recent: RecentRow[] = [];
        const previous: PreviousRow[] = [];
        for (const view of views) {
          if (view.status === "Completed") {
            previous.push({
              id: view.id,
              title: view.title,
              completedOn: view.completedAt,
              certificateId:
                earnedCertificate && certificateAvailableOn(view, completion)
                  ? earnedCertificate.id
                  : undefined,
            });
          } else {
            recent.push({
              id: view.id,
              title: view.title,
              // Locked covers the prerequisite AND the purchase gate for
              // paid modules (same backend verdict the seminar page uses).
              locked: !canAccessView(view),
              started: view.started,
              hasVideos: view.videos.length > 0,
            });
          }
        }
        setRecentRows(recent);
        // Latest completion first, matching the Figma frame.
        setPreviousRows(previous.reverse());
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const empty = loaded && recentRows.length === 0 && previousRows.length === 0;

  return (
    <div className="lg:ml-[101px] lg:mr-[42px] lg:min-h-[732px] lg:pt-[45px]">
      <h1 className="text-[24px] font-semibold leading-normal text-black">
        Modules Taken
      </h1>

      {empty && (
        <div className="mt-[31px] max-w-[1012px] rounded-[15px] bg-white px-[24px] py-[32px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[37px]">
          <p className="text-[18px] font-bold leading-normal text-black">
            No modules yet
          </p>
          <p className="mt-[8px] text-[15px] leading-normal text-[#7d7d7d]">
            Register for a seminar module to begin your training.
          </p>
          <Link
            href={ROUTES.seminars}
            className="mt-[16px] inline-block whitespace-pre text-[18px] leading-normal text-[#c00]"
          >
            {"View Seminars  >"}
          </Link>
        </div>
      )}

      {recentRows.length > 0 && (
        <>
          <p className="mt-[31px] text-[18px] leading-normal text-black">
            Recent
          </p>
          <div className="mt-[24px] flex max-w-[1012px] flex-col gap-[31px]">
            {recentRows.map((module) => (
              <div
                key={module.id}
                className="flex min-h-[104px] items-center justify-between gap-[12px] rounded-[15px] bg-white px-[24px] py-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[37px] lg:py-0"
              >
                <div>
                  <p className="text-[18px] font-bold leading-normal text-black">
                    {module.title}
                  </p>
                  {module.startedOn && (
                    <p className="mt-[14px] text-[12px] leading-normal text-[#7d7d7d]">
                      Started: {formatDate(module.startedOn)}
                    </p>
                  )}
                </div>
                {module.locked ? (
                  <span className="flex shrink-0 items-center gap-[8px] text-[18px] leading-normal text-[#7d7d7d]">
                    <Lock aria-hidden className="size-[18px] shrink-0" />
                    Locked
                  </span>
                ) : (
                  <button
                    type="button"
                    // Opens THIS module's flow: its videos (or exam when it
                    // has none), or the Seminars page when not yet enrolled.
                    onClick={() => {
                      setActiveSeminarId(module.id);
                      router.push(
                        !module.started
                          ? ROUTES.seminars
                          : module.hasVideos
                            ? "/seminars/modules/1"
                            : "/seminars/exam"
                      );
                    }}
                    className="cursor-pointer whitespace-pre text-[18px] leading-normal text-[#c00]"
                  >
                    {"Continue  >"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {previousRows.length > 0 && (
        <>
          <p className="mt-[64px] text-[18px] leading-normal text-black">
            Previous
          </p>
          <div className="mt-[22px] flex max-w-[1012px] flex-col gap-[31px]">
            {previousRows.map((module) => (
              <div
                key={module.id}
                className="flex min-h-[104px] items-center justify-between gap-[12px] rounded-[15px] bg-white px-[24px] py-[24px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] lg:px-[37px] lg:py-0 lg:pl-[41px]"
              >
                <div>
                  <p className="text-[18px] font-bold leading-normal text-black">
                    {module.title}
                  </p>
                  {module.completedOn && (
                    <p className="mt-[14px] text-[12px] leading-normal text-[#7d7d7d]">
                      Completed: {formatDate(module.completedOn)}
                    </p>
                  )}
                </div>
                {module.certificateId ? (
                  <Link
                    href={`${ROUTES.accountCertificates}/${module.certificateId}`}
                    className="whitespace-pre text-[18px] leading-normal text-[#c00]"
                  >
                    {"View Certificate  >"}
                  </Link>
                ) : (
                  <Link
                    // from=modules sends the completion page's Back action
                    // to Modules Taken instead of the Seminar catalog.
                    href="/seminars/certificate?from=modules"
                    // That page renders the completion of the ACTIVE
                    // module, so make this one active first. An
                    // intermediate module shows its completion details
                    // and the next module — never a certificate.
                    onClick={() => setActiveSeminarId(module.id)}
                    className="whitespace-pre text-[18px] leading-normal text-[#c00]"
                  >
                    {"View Completion  >"}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
