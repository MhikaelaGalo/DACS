"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DARK_BUTTON, OUTLINE_BUTTON } from "@/components/profile/buttons";
import { useAuth } from "@/components/providers/AuthProvider";
import { ROUTES } from "@/constants/routes";
import { errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/utils/format";
import {
  CERTIFICATE_TEMPLATE_URL,
  certificateValidityLabel,
  downloadCompositeCertificate,
  downloadIssuedCertificate,
  fetchApprovedCertificateById,
  fetchIssuedCertificateBlob,
  fetchIssuedCertificateById,
} from "@/services/certificate.service";
import type {
  DacsCertificateView,
  IssuedDacsCertificateView,
} from "@/types/certificate";

// Figma: Certificate 368:9 — the certificate on a plain white page
// (no sidebar, no footer), with Download / Print / Back actions below.
//
// Two sources, in priority order:
//   1. ISSUED — staff uploaded the real certificate file and officially
//      issued it: the actual file (PDF or image) renders and downloads,
//      fetched through the authenticated owner-only endpoint.
//   2. APPROVED only — the legacy composite view: the farmer's name,
//      SEM number and approval date overlaid on the template image.
// Resolved from the SIGNED-IN account only — a copied URL never opens
// another account's certificate (the backend enforces ownership too).
// Both viewer variants download through certificate.service, which renders
// the composite at the same percentages used on screen and saves the file
// from an anchored link, so the saved copy is the certificate on display.

export default function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const [issued, setIssued] = useState<IssuedDacsCertificateView | null>(null);
  const [issuedFileUrl, setIssuedFileUrl] = useState<string | null>(null);
  const [issuedFileType, setIssuedFileType] = useState<string>("");
  const [earned, setEarned] = useState<DacsCertificateView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The real issued file wins over the composite fallback.
        const issuedCertificate = await fetchIssuedCertificateById(id);
        if (issuedCertificate) {
          const blob = await fetchIssuedCertificateBlob(issuedCertificate);
          if (cancelled) return;
          setIssued(issuedCertificate);
          setIssuedFileType(blob.type);
          setIssuedFileUrl(URL.createObjectURL(blob));
          setLoaded(true);
          return;
        }
        const approved = await fetchApprovedCertificateById(id);
        if (cancelled) return;
        setEarned(approved ?? null);
        setLoaded(true);
      } catch {
        if (cancelled) return;
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Object URLs hold the blob in memory until revoked.
  useEffect(() => {
    return () => {
      if (issuedFileUrl) URL.revokeObjectURL(issuedFileUrl);
    };
  }, [issuedFileUrl]);

  useEffect(() => {
    if (loaded && !earned && !issued) router.replace(ROUTES.account);
  }, [loaded, earned, issued, router]);

  // ---- Issued certificate: the actual staff-uploaded file -----------------
  if (issued && issuedFileUrl) {
    const validity = certificateValidityLabel(issued.validUntil);
    const isPdf = issuedFileType.includes("pdf");

    const handleDownload = async () => {
      if (downloading) return;
      setDownloadError(null);
      setDownloading(true);
      try {
        await downloadIssuedCertificate(issued);
      } catch (error) {
        setDownloadError(
          errorMessage(
            error,
            "Unable to download the certificate. Please try again."
          )
        );
      } finally {
        setDownloading(false);
      }
    };

    return (
      <div className="bg-white">
        {/* Minimal print stylesheet: printing shows only the certificate. */}
        <style>{`@media print {
          body * { visibility: hidden; }
          #certificate-print-area, #certificate-print-area * { visibility: visible; }
          #certificate-print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
        }`}</style>

        <div className="flex w-full justify-center px-[24px] py-[40px] lg:px-[42px] lg:py-[45px]">
          <div className="w-full max-w-[1024px]">
            <div id="certificate-print-area" className="mx-auto w-full">
              {isPdf ? (
                <iframe
                  src={issuedFileUrl}
                  title={issued.title}
                  className="h-[70vh] min-h-[420px] w-full rounded-[8px] border border-[#d9d9d9]"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={issuedFileUrl}
                  alt={issued.title}
                  className="mx-auto h-auto w-full object-contain"
                />
              )}
            </div>

            <div className="mt-[24px] flex w-full flex-col gap-[8px] text-center print:hidden sm:flex-row sm:justify-between sm:text-left">
              <p className="text-[15px] leading-normal text-[#7d7d7d]">
                {issued.title}
                <span
                  className={`ml-[10px] inline-block rounded-full px-[12px] py-[2px] text-[12px] font-semibold leading-normal ${
                    validity === "Valid"
                      ? "bg-[#e7f6e4] text-[#1d7a0b]"
                      : "bg-[#fdecec] text-[#a11212]"
                  }`}
                >
                  {validity}
                </span>
              </p>
              <p className="shrink-0 text-[15px] leading-normal text-[#7d7d7d]">
                Certificate No. {issued.certificateNumber} · Issued{" "}
                {formatDate(issued.issuedAt)} · Valid until{" "}
                {formatDate(issued.validUntil)}
              </p>
            </div>

            <div className="mt-[31px] flex w-full flex-col gap-[20px] print:hidden sm:flex-row sm:justify-center">
              {/* Downloads the actual certificate file DACS staff issued. */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading}
                className={`${DARK_BUTTON} disabled:opacity-60 sm:w-[216px]`}
              >
                {downloading ? "Downloading…" : "Download Certificate"}
              </button>
              {/* PDFs print from the viewer's own toolbar. */}
              {!isPdf && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className={`${DARK_BUTTON} sm:w-[216px]`}
                >
                  Print Certificate
                </button>
              )}
              <Link
                href={ROUTES.account}
                className={`${OUTLINE_BUTTON} sm:w-[216px]`}
              >
                Back
              </Link>
            </div>
            {downloadError && (
              <p
                role="alert"
                className="mt-[16px] text-center text-[14px] leading-normal text-[#c00] print:hidden"
              >
                {downloadError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Approved but not yet issued: legacy composite view -----------------
  if (!earned) return null;

  const recipientName = user?.fullName ?? "—";
  const imageUrl = CERTIFICATE_TEMPLATE_URL;
  const title = earned.title;
  const earnedCertificate: DacsCertificateView = earned;

  const handleCompositeDownload = async () => {
    if (downloading) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      await downloadCompositeCertificate(
        earnedCertificate,
        recipientName,
        formatDate(earnedCertificate.issuedAt)
      );
    } catch (error) {
      setDownloadError(
        errorMessage(
          error,
          "Unable to download the certificate. Please try again."
        )
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="bg-white">
      {/* Minimal print stylesheet: printing shows only the certificate. */}
      <style>{`@media print {
        body * { visibility: hidden; }
        #certificate-print-area, #certificate-print-area * { visibility: visible; }
        #certificate-print-area { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
      }`}</style>

      <div className="flex w-full justify-center px-[24px] py-[40px] lg:px-[42px] lg:py-[45px]">
        <div className="w-full max-w-[1024px]">
          <div id="certificate-print-area" className="relative mx-auto w-full">
            <img
              src={imageUrl}
              alt={title}
              className="mx-auto h-auto w-full object-contain"
            />
            {earned && (
              <>
                {/* The farmer's own details over the design's baked-in
                    placeholders (percentage-positioned so they track the
                    responsive image; print-color-adjust keeps the white
                    patches painted when printing). */}
                <p className="absolute left-[25%] top-[25%] flex h-[5%] w-[50%] items-center justify-center bg-white text-center font-serif text-[clamp(14px,2.6vw,30px)] leading-none text-black [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
                  {recipientName}
                </p>
                <p className="absolute left-[30%] top-[31.8%] flex h-[2.6%] w-[40%] items-center justify-center bg-white text-center font-serif text-[clamp(9px,1.3vw,15px)] leading-none text-black [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
                  ID# {earned.certificateNumber}
                </p>
                <p className="absolute left-[25%] top-[56%] flex h-[3.5%] w-[50%] items-center justify-center bg-white text-center font-serif text-[clamp(10px,1.6vw,19px)] italic leading-none text-black [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
                  on {formatDate(earned.issuedAt)}
                </p>
              </>
            )}
          </div>

          {earned && (
            <div className="mt-[24px] flex w-full flex-col gap-[8px] text-center print:hidden sm:flex-row sm:justify-between sm:text-left">
              <p className="text-[15px] leading-normal text-[#7d7d7d]">
                {earned.title}
              </p>
              <p className="shrink-0 text-[15px] leading-normal text-[#7d7d7d]">
                Certificate No. {earned.certificateNumber} · Issued{" "}
                {formatDate(earned.issuedAt)}
              </p>
            </div>
          )}

          <div className="mt-[31px] flex w-full flex-col gap-[20px] print:hidden sm:flex-row sm:justify-center">
            {/* Downloads the personalized composite — the raw template
                still carries the baked placeholders. */}
            <button
              type="button"
              onClick={handleCompositeDownload}
              disabled={downloading}
              className={`${DARK_BUTTON} disabled:opacity-60 sm:w-[216px]`}
            >
              {downloading ? "Downloading…" : "Download Certificate"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className={`${DARK_BUTTON} sm:w-[216px]`}
            >
              Print Certificate
            </button>
            <Link
              href={ROUTES.accountModules}
              className={`${OUTLINE_BUTTON} sm:w-[216px]`}
            >
              Back
            </Link>
          </div>
          {downloadError && (
            <p
              role="alert"
              className="mt-[16px] text-center text-[14px] leading-normal text-[#c00] print:hidden"
            >
              {downloadError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
