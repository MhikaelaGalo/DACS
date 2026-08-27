"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SeminarPageHeader } from "@/components/seminars/SeminarPageHeader";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import {
  listMyCertificateRequests,
  requestCertificate,
  type ApiCertificateRequest,
} from "@/lib/api/seminars";
import { formatDate } from "@/lib/utils/format";
import { downloadCertificateById } from "@/services/certificate.service";
import {
  fetchSeminarState,
  canAccessView,
  certificateAvailableOn,
  finalRequiredModuleNumber,
  lockReasonFor,
  nextModuleAfter,
  pickActiveView,
  setActiveSeminarId,
  type SeminarCompletion,
  type SeminarView,
} from "@/services/seminar.service";
import {
  LAST_QUIZ_RESULT_KEY,
  type LastQuizResult,
} from "@/lib/seminarHandoff";

// Figma: Module Seminar Certification (305:2), rendered at 0.75 scale.
// The completion details come from the DACS backend (module progress and
// best quiz attempt); the Certificate of Attendance follows the real
// workflow — requested after Modules 1-3 are complete, approved by DACS
// staff with an SEM-YYYY-NNNNNN number.
//
// Admission is the ACCOUNT's seminar-completion record (GET
// /api/seminars/me/progress -> seminarCompletion), not the active
// module's latest exam attempt: an account that finished Modules 1-3
// reaches its certificate straight away, on any device and after any
// number of logouts, and is never sent back through an exam to get here.
export default function ModuleSeminarCertificationPage() {
  const { user } = useAuth();
  const router = useRouter();
  // null until the guard passes — the page renders nothing while checking.
  const [seminar, setSeminar] = useState<SeminarView | null>(null);
  const [freshResult, setFreshResult] = useState<LastQuizResult | null>(null);
  const [allComplete, setAllComplete] = useState(false);
  const [completion, setCompletion] = useState<SeminarCompletion | null>(null);
  const [certificate, setCertificate] = useState<ApiCertificateRequest | null>(
    null
  );
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [nextModule, setNextModule] = useState<{
    id: string;
    name: string;
    accessible: boolean;
    lockReason?: string;
    hasVideos: boolean;
  } | null>(null);
  // True when opened via Modules Taken (?from=modules).
  const [fromModules, setFromModules] = useState(false);

  const loadCertificateStatus = useCallback(async () => {
    try {
      const requests = await listMyCertificateRequests();
      // Latest PENDING/APPROVED wins; else the newest request (rejected).
      const active =
        requests.find(
          (request) =>
            request.status === "APPROVED" || request.status === "PENDING"
        ) ??
        requests[0] ??
        null;
      setCertificate(active);
    } catch {
      /* Status stays unknown; the request button reports failures. */
    }
  }, []);

  useEffect(() => {
    setFromModules(
      new URLSearchParams(window.location.search).get("from") === "modules"
    );
    try {
      const raw = window.sessionStorage.getItem(LAST_QUIZ_RESULT_KEY);
      if (raw) setFreshResult(JSON.parse(raw) as LastQuizResult);
    } catch {
      /* No handoff — server data covers it. */
    }
    let cancelled = false;
    void (async () => {
      try {
        const { views, completion: cycle } = await fetchSeminarState();
        if (cancelled) return;
        let active = pickActiveView(views);
        /*
         * The active-module pointer is a UI convenience kept in local
         * storage, so it can be missing (new device, cleared browser) or
         * still aimed at an unfinished module. When the account has
         * finished the seminar, land on the module that ENDS the required
         * sequence — that is where the certificate lives — rather than
         * bouncing back into an exam it already passed.
         */
        if (cycle.allRequiredCompleted && (!active || !active.examPassed)) {
          const finalNumber = finalRequiredModuleNumber(cycle);
          active =
            views.find(
              (view) => view.moduleNumber === finalNumber && view.completed
            ) ??
            views.find((view) => view.completed) ??
            views.find((view) => view.examPassed) ??
            active;
        }
        if (!active) {
          router.replace(ROUTES.seminars);
          return;
        }
        if (!active.examPassed && !cycle.allRequiredCompleted) {
          const examAvailable =
            canAccessView(active) &&
            active.started &&
            active.videos.every((video) => video.watched);
          router.replace(examAvailable ? "/seminars/exam" : ROUTES.seminars);
          return;
        }
        setSeminar(active);
        setCompletion(cycle);
        /*
         * The certificate belongs to the whole required sequence, so it
         * appears only where that sequence ENDS and only once the backend
         * confirms every required module is done. An intermediate module's
         * completion view offers the next module instead — it has not
         * earned a certificate and must not imply one.
         */
        const certificateHere = certificateAvailableOn(active, cycle);
        setAllComplete(certificateHere);

        if (!certificateHere) {
          const nextView = nextModuleAfter(views, active);
          if (nextView) {
            setNextModule({
              id: nextView.id,
              name: `Module ${nextView.moduleNumber}`,
              accessible: canAccessView(nextView),
              lockReason: lockReasonFor(nextView),
              hasVideos: nextView.videos.length > 0,
            });
          }
        }

        if (certificateHere) {
          /*
           * The progress payload already carries this account's live
           * certificate, so the common path needs no second request. Only
           * when there is none (so a REJECTED one may need its reason and
           * the Request button) is the certificate list fetched.
           */
          const earned = cycle.certificate;
          if (earned) {
            setCertificate({
              id: earned.id,
              status: earned.status,
              requestedAt: earned.approvedAt ?? "",
              certificateNumber: earned.certificateNumber,
              certificateIssuedAt: earned.approvedAt,
              reviewNotes: null,
              hasCertificateFile: earned.hasCertificateFile,
              certificateFileName: null,
              certificateFileMimeType: null,
              fileUploadedAt: null,
              issuedAt: earned.issuedAt,
              validUntil: earned.validUntil,
              validityStatus: earned.validityStatus,
            });
          } else {
            await loadCertificateStatus();
          }
        }
      } catch {
        router.replace(ROUTES.seminars);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadCertificateStatus]);

  async function onRequestCertificate() {
    if (requesting) return;
    setCertError(null);
    setRequesting(true);
    try {
      await requestCertificate();
      await loadCertificateStatus();
    } catch (error) {
      setCertError(
        errorMessage(
          error,
          "Unable to request the certificate right now. Please try again."
        )
      );
    } finally {
      setRequesting(false);
    }
  }

  /*
   * Saves the certificate the card is showing — the same backend record,
   * so the file carries this account's name, its SEM number and its issue
   * date on the existing design. The backend only ever resolves the
   * caller's own certificate, so an id from anywhere else saves nothing.
   */
  async function onDownloadCertificate(certificateId: string) {
    if (downloading) return;
    setCertError(null);
    setDownloading(true);
    try {
      await downloadCertificateById(
        certificateId,
        user?.fullName ?? "—",
        formatDate
      );
    } catch (error) {
      setCertError(
        errorMessage(
          error,
          "Unable to download the certificate right now. Please try again."
        )
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!seminar) return null;

  const certificateName = user?.fullName ?? "—";
  const resultForThisModule =
    freshResult && freshResult.seminarId === seminar.id ? freshResult : null;
  const completedDate = resultForThisModule
    ? formatDate(resultForThisModule.completedAt)
    : seminar.completedAt
      ? formatDate(seminar.completedAt)
      : "—";
  const score =
    resultForThisModule?.percentage ?? seminar.bestScorePercent ?? null;

  return (
    <div className="bg-white">
      <SeminarPageHeader
        title={seminar.title}
        activeStep={3}
        backHref={fromModules ? ROUTES.accountModules : ROUTES.seminars}
      />

      {/* Exam result summary (the graded answers stay on the server). */}
      <div className="mx-auto mt-[32px] max-w-[1440px] px-[20px] lg:mt-[43px] lg:pl-[122px] lg:pr-[123px]">
        <section className="w-full rounded-[15px] bg-white pb-[40px] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]">
          <div className="px-[24px] pt-[32px] lg:px-[59px] lg:pt-[44px]">
            <h2 className="text-[24px] font-bold leading-normal text-black">
              EXAM RESULT
            </h2>
            <div className="mt-[24px] flex flex-col gap-[10px] text-[16px] leading-normal text-black lg:text-[18px]">
              <p>
                Score:{" "}
                <span className="font-semibold">
                  {score != null ? `${score}%` : "—"}
                </span>{" "}
                (passing score: {seminar.passingScore}%)
              </p>
              <p>
                Attempts:{" "}
                <span className="font-semibold">
                  {seminar.quizAttemptCount || 1}
                </span>
              </p>
              <p className="text-[15px] text-[#7d7d7d]">
                Your submitted answers are recorded and graded by DACS —
                individual answer keys are never shown, so retakeable exams
                stay fair for everyone.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Module completed */}
      <div className="mx-auto max-w-[1440px] px-[20px] pb-[60px] lg:pb-[77px]">
        <p className="mt-[60px] text-center text-[24px] font-bold leading-normal text-black lg:mt-[79px]">
          MODULE COMPLETED!
        </p>
        <div className="mx-auto mt-[23px] w-full max-w-[619px] rounded-[15px] border border-[#8e8e8e] bg-[#efeded] px-[24px] pb-[24px] pt-[17px] text-center lg:min-h-[171px] lg:px-0 lg:pb-[13px]">
          <p className="text-[16px] leading-normal text-black lg:text-[18px]">
            You have passed {seminar.title}
          </p>
          <p className="mt-[21px] text-[16px] font-medium leading-normal text-[#7d7d7d] lg:text-[18px]">
            Completion Details
          </p>
          <p className="mt-[22px] text-[16px] font-semibold leading-normal text-black lg:text-[18px]">
            {certificateName}
          </p>
          <p className="mt-[11px] text-[16px] leading-normal text-black lg:text-[18px]">
            {seminar.title}
          </p>
        </div>
        <div className="mx-auto mt-[23px] flex w-full max-w-[619px] flex-col gap-[8px] sm:flex-row sm:justify-between lg:pl-[34px] lg:pr-[38px]">
          <p className="text-[15px] leading-normal text-[#7d7d7d]">
            Completed: {completedDate}
          </p>
          <p className="text-[15px] leading-normal text-[#7d7d7d]">
            Score: {score != null ? `${score}%` : "—"}
          </p>
        </div>

        {/* Certificate of Attendance — the real staff-approved document.
            The whole section is absent (not merely hidden) unless this is
            the end of the required sequence AND the backend confirms every
            required module is complete: finishing Module 1 or 2 earns no
            certificate, so none is named, dated or offered there. */}
        {allComplete && (
        <div className="mx-auto mt-[40px] w-full max-w-[619px] rounded-[15px] border border-[#8e8e8e] bg-white px-[24px] py-[24px]">
          <p className="text-center text-[18px] font-bold leading-normal text-black">
            Certificate of Attendance
          </p>
          {allComplete && certificate?.status === "APPROVED" && (
            <div className="mt-[12px] text-center">
              <p className="text-[15px] leading-normal text-black">
                Approved — Certificate No.{" "}
                <span className="font-semibold">
                  {certificate.certificateNumber}
                </span>
                {certificate.certificateIssuedAt
                  ? ` · Issued ${formatDate(certificate.certificateIssuedAt)}`
                  : ""}
              </p>
              {completion?.completionValidUntil && (
                <p className="mt-[6px] text-[15px] leading-normal text-[#7d7d7d]">
                  Valid until {formatDate(completion.completionValidUntil)}
                </p>
              )}
              {/* Two distinct actions: open the certificate, or save the
                  file. The link alone used to carry both labels, so the
                  page offered no way to actually download anything. */}
              <div className="mt-[16px] flex flex-col gap-[12px]">
                <Link
                  href={`${ROUTES.accountCertificates}/${certificate.id}`}
                  className="mx-auto flex h-[64px] w-full items-center justify-center rounded-[15px] bg-[#25a50e] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
                >
                  <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                    View Certificate
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void onDownloadCertificate(certificate.id)}
                  disabled={downloading}
                  className="mx-auto flex h-[64px] w-full cursor-pointer items-center justify-center gap-[14px] rounded-[15px] border border-[#181818] bg-white shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60"
                >
                  <img
                    src="/figma/icon-download.svg"
                    alt=""
                    className="size-[16px] shrink-0"
                  />
                  <span className="text-[18px] font-bold leading-normal text-[#181818]">
                    {downloading ? "Downloading…" : "Download Certificate"}
                  </span>
                </button>
              </div>
            </div>
          )}
          {allComplete && certificate?.status === "PENDING" && (
            <p className="mt-[12px] text-center text-[15px] leading-normal text-[#9a7800]">
              Your certificate request is awaiting DACS staff approval —
              you&apos;ll be notified once it is issued.
            </p>
          )}
          {allComplete &&
            (certificate === null || certificate.status === "REJECTED") && (
              <div className="mt-[12px] text-center">
                {certificate?.status === "REJECTED" && (
                  <p className="mb-[8px] text-[15px] leading-normal text-[#a11212]">
                    Your previous request was declined
                    {certificate.reviewNotes
                      ? `: ${certificate.reviewNotes}`
                      : "."}
                  </p>
                )}
                <button
                  type="button"
                  onClick={onRequestCertificate}
                  disabled={requesting}
                  className="mx-auto flex h-[64px] w-full cursor-pointer items-center justify-center rounded-[15px] bg-[#25a50e] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] disabled:opacity-60"
                >
                  <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                    {requesting
                      ? "Requesting..."
                      : "Request Certificate of Attendance"}
                  </span>
                </button>
              </div>
            )}
          {certError && (
            <p
              role="alert"
              className="mt-[10px] text-center text-[14px] leading-normal text-[#c00]"
            >
              {certError}
            </p>
          )}
        </div>
        )}

        {/* An intermediate module's next step: the module after it. */}
        {nextModule && (
          <>
            <button
              type="button"
              onClick={() => {
                if (!nextModule.accessible) return;
                setActiveSeminarId(nextModule.id);
                router.push(
                  nextModule.hasVideos ? "/seminars/modules/1" : "/seminars/exam"
                );
              }}
              disabled={!nextModule.accessible}
              className={`mx-auto mt-[22px] flex h-[64px] w-full max-w-[619px] items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)] ${
                nextModule.accessible
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-50"
              }`}
            >
              <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
                Go to Next Module
              </span>
            </button>
            {!nextModule.accessible && nextModule.lockReason && (
              <p className="mx-auto mt-[10px] w-full max-w-[619px] text-center text-[15px] leading-normal text-[#7d7d7d]">
                {nextModule.name} is locked. {nextModule.lockReason}
              </p>
            )}
          </>
        )}
        <Link
          href={fromModules ? ROUTES.accountModules : ROUTES.seminars}
          className="mx-auto mt-[22px] flex h-[64px] w-full max-w-[619px] items-center justify-center rounded-[15px] bg-[#181818] shadow-[0px_0px_15px_0px_rgba(0,0,0,0.15)]"
        >
          <span className="text-[18px] font-bold leading-normal text-[#f4f4f4]">
            {fromModules ? "Back" : "Back to Seminar"}
          </span>
        </Link>
      </div>
    </div>
  );
}
